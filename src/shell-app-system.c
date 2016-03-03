/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */

#include "config.h"

#include "shell-app-system.h"
#include "shell-app-usage.h"
#include <string.h>

#include <gio/gio.h>
#include <glib/gi18n.h>

#include <eosmetrics/eosmetrics.h>

#include "shell-app-private.h"
#include "shell-window-tracker-private.h"
#include "shell-app-system-private.h"
#include "shell-global.h"
#include "shell-util.h"

/* Occurs when an application visible to the shell is opened or closed. The
 * payload varies depending on whether it is given as an opening event or a
 * closed event. If it is an opening event, the payload is a human-readable
 * application name. If it is a closing event, the payload is empty. The key
 * used is a pointer to the corresponding ShellApp.
 */
#define SHELL_APP_IS_OPEN_EVENT "b5e11a3d-13f8-4219-84fd-c9ba0bf3d1f0"

/* Additional key used to map a renamed desktop file to its previous name;
 * for instance, org.gnome.Totem.desktop would use this key to point to
 * 'totem.desktop'
 */
#define X_ENDLESS_ALIAS_KEY     "X-Endless-Alias"

/* Vendor prefixes are something that can be preprended to a .desktop
 * file name.  Undo this.
 */
static const char*const vendor_prefixes[] = { "gnome-",
                                              "fedora-",
                                              "mozilla-",
                                              "debian-",
                                              NULL };

enum {
  APP_STATE_CHANGED,
  INSTALLED_CHANGED,
  APP_INFO_CHANGED,
  LAST_SIGNAL
};

static guint signals[LAST_SIGNAL] = { 0 };

struct _ShellAppSystemPrivate {
  GHashTable *running_apps;
  GHashTable *starting_apps;
  GHashTable *id_to_app;
  GHashTable *startup_wm_class_to_id;
  GHashTable *alias_to_id;
};

static void shell_app_system_finalize (GObject *object);

G_DEFINE_TYPE(ShellAppSystem, shell_app_system, G_TYPE_OBJECT);

static void shell_app_system_class_init(ShellAppSystemClass *klass)
{
  GObjectClass *gobject_class = (GObjectClass *)klass;

  gobject_class->finalize = shell_app_system_finalize;

  signals[APP_STATE_CHANGED] = g_signal_new ("app-state-changed",
                                             SHELL_TYPE_APP_SYSTEM,
                                             G_SIGNAL_RUN_LAST,
                                             0,
                                             NULL, NULL, NULL,
                                             G_TYPE_NONE, 1,
                                             SHELL_TYPE_APP);
  signals[INSTALLED_CHANGED] =
    g_signal_new ("installed-changed",
		  SHELL_TYPE_APP_SYSTEM,
		  G_SIGNAL_RUN_LAST,
		  G_STRUCT_OFFSET (ShellAppSystemClass, installed_changed),
          NULL, NULL, NULL,
		  G_TYPE_NONE, 0);

  signals[APP_INFO_CHANGED] = g_signal_new ("app-info-changed",
                                             SHELL_TYPE_APP_SYSTEM,
                                             G_SIGNAL_RUN_LAST,
                                             0,
                                             NULL, NULL, NULL,
                                             G_TYPE_NONE, 1,
                                             SHELL_TYPE_APP);

  g_type_class_add_private (gobject_class, sizeof (ShellAppSystemPrivate));
}

static void
scan_alias_to_id (ShellAppSystem *self)
{
  ShellAppSystemPrivate *priv = self->priv;
  GList *apps, *l;

  g_hash_table_remove_all (priv->alias_to_id);

  apps = g_app_info_get_all ();
  for (l = apps; l != NULL; l = l->next)
    {
      GAppInfo *info = l->data;
      const char *alias, *id, *desktop_alias;

      id = g_app_info_get_id (info);
      alias = g_desktop_app_info_get_string (G_DESKTOP_APP_INFO (info), X_ENDLESS_ALIAS_KEY);
      if (alias == NULL)
        continue;

      desktop_alias = g_strconcat (alias, ".desktop", NULL);

      g_hash_table_insert (priv->alias_to_id, g_strdup (desktop_alias), g_strdup (id));

      g_free (desktop_alias);
    }

  g_list_free_full (apps, g_object_unref);
}

static void
scan_startup_wm_class_to_id (ShellAppSystem *self)
{
  ShellAppSystemPrivate *priv = self->priv;
  GList *apps, *l;

  g_hash_table_remove_all (priv->startup_wm_class_to_id);

  apps = g_app_info_get_all ();
  for (l = apps; l != NULL; l = l->next)
    {
      GAppInfo *info = l->data;
      const char *startup_wm_class, *id, *old_id;

      id = g_app_info_get_id (info);
      startup_wm_class = g_desktop_app_info_get_startup_wm_class (G_DESKTOP_APP_INFO (info));

      if (startup_wm_class == NULL)
        continue;

      /* In case multiple .desktop files set the same StartupWMClass, prefer
       * the one where ID and StartupWMClass match */
      old_id = g_hash_table_lookup (priv->startup_wm_class_to_id, startup_wm_class);
      if (old_id == NULL || strcmp (id, startup_wm_class) == 0)
        g_hash_table_insert (priv->startup_wm_class_to_id,
                             g_strdup (startup_wm_class), g_strdup (id));
    }

  g_list_free_full (apps, g_object_unref);
}

static GDesktopAppInfo *
get_new_desktop_app_info_from_app (ShellApp *app)
{
  GDesktopAppInfo *info;
  const char *id;

  if (shell_app_is_window_backed (app))
    return NULL;

  /* If g_app_info_delete() was called, such as when a custom desktop
   * icon is removed, the desktop ID of the underlying GDesktopAppInfo
   * will be set to NULL.
   * So we explicitly check for that case and mark the app as stale.
   * See https://git.gnome.org/browse/glib/tree/gio/gdesktopappinfo.c?h=glib-2-44&id=2.44.0#n3682
   */
  id = shell_app_get_id (app);
  if (id == NULL)
    return NULL;

  return g_desktop_app_info_new (id);
}

static gboolean
app_info_changed (ShellApp *app, GDesktopAppInfo *info)
{
  GIcon *app_icon;
  GIcon *new_icon;
  GAppInfo *app_info = G_APP_INFO (shell_app_get_app_info (app));
  GAppInfo *new_info = G_APP_INFO (info);

  if (!app_info)
    return TRUE;

  app_icon = g_app_info_get_icon (app_info);
  new_icon = g_app_info_get_icon (new_info);

  return !g_app_info_equal (app_info, new_info) || !g_icon_equal (app_icon, new_icon);
}

static void
remove_or_update_app_from_info (ShellAppSystem *self)
{
  GHashTableIter iter;
  ShellApp *app;

  g_hash_table_iter_init (&iter, self->priv->id_to_app);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer) &app))
    {
      GDesktopAppInfo *app_info = get_new_desktop_app_info_from_app (app);

      if (!app_info)
        {
          // App is stale, we remove it
          g_hash_table_iter_remove (&iter);
          continue;
        }

      if (app_info_changed (app, app_info))
        {
          _shell_app_set_app_info (app, app_info);
          g_signal_emit (self, signals[APP_INFO_CHANGED], 0, app);
        }

      g_object_unref (app_info);
    }
}

static void
installed_changed (GAppInfoMonitor *monitor,
                   gpointer         user_data)
{
  ShellAppSystem *self = user_data;

  scan_alias_to_id (self);

  scan_startup_wm_class_to_id (self);

  remove_or_update_app_from_info (self);

  g_signal_emit (self, signals[INSTALLED_CHANGED], 0, NULL);
}

static void
shell_app_system_init (ShellAppSystem *self)
{
  ShellAppSystemPrivate *priv;
  GAppInfoMonitor *monitor;

  self->priv = priv = G_TYPE_INSTANCE_GET_PRIVATE (self,
                                                   SHELL_TYPE_APP_SYSTEM,
                                                   ShellAppSystemPrivate);

  priv->running_apps = g_hash_table_new_full (NULL, NULL, (GDestroyNotify) g_object_unref, NULL);
  priv->starting_apps = g_hash_table_new_full (NULL, NULL, (GDestroyNotify) g_object_unref, NULL);
  priv->id_to_app = g_hash_table_new_full (g_str_hash, g_str_equal,
                                           NULL,
                                           (GDestroyNotify)g_object_unref);

  priv->startup_wm_class_to_id = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  priv->alias_to_id = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);

  monitor = g_app_info_monitor_get ();
  g_signal_connect (monitor, "changed", G_CALLBACK (installed_changed), self);
  installed_changed (monitor, self);
}

static void
shell_app_system_finalize (GObject *object)
{
  ShellAppSystem *self = SHELL_APP_SYSTEM (object);
  ShellAppSystemPrivate *priv = self->priv;

  g_hash_table_destroy (priv->running_apps);
  g_hash_table_destroy (priv->starting_apps);
  g_hash_table_destroy (priv->id_to_app);
  g_hash_table_destroy (priv->startup_wm_class_to_id);
  g_hash_table_destroy (priv->alias_to_id);

  G_OBJECT_CLASS (shell_app_system_parent_class)->finalize (object);
}

/**
 * shell_app_system_get_default:
 *
 * Return Value: (transfer none): The global #ShellAppSystem singleton
 */
ShellAppSystem *
shell_app_system_get_default ()
{
  static ShellAppSystem *instance = NULL;

  if (instance == NULL)
    instance = g_object_new (SHELL_TYPE_APP_SYSTEM, NULL);

  return instance;
}

/**
 * shell_app_system_lookup_app:
 *
 * Find a #ShellApp corresponding to an id.
 *
 * Return value: (transfer none): The #ShellApp for id, or %NULL if none
 */
ShellApp *
shell_app_system_lookup_app (ShellAppSystem   *self,
                             const char       *id)
{
  ShellAppSystemPrivate *priv = self->priv;
  ShellApp *app;
  GDesktopAppInfo *info;

  app = g_hash_table_lookup (priv->id_to_app, id);
  if (app)
    return app;

  info = g_desktop_app_info_new (id);
  if (!info)
    return NULL;

  app = _shell_app_new (info);
  g_hash_table_insert (priv->id_to_app, (char *) shell_app_get_id (app), app);

  alias = g_desktop_app_info_get_string (info, X_ENDLESS_ALIAS_KEY);
  if (alias != NULL && g_hash_table_lookup (priv->alias_to_id, alias) == NULL)
    {
      char *desktop_alias = g_strconcat (alias, ".desktop", NULL);

      g_hash_table_insert (priv->alias_to_id, g_strdup (desktop_alias), g_strdup (id));

      g_free (desktop_alias);
    }

  g_object_unref (info);
  return app;
}

/**
 * shell_app_system_lookup_heuristic_basename:
 * @system: a #ShellAppSystem
 * @id: Probable application identifier
 *
 * Find a valid application corresponding to a given
 * heuristically determined application identifier
 * string, or %NULL if none.
 *
 * Returns: (transfer none): A #ShellApp for @name
 */
ShellApp *
shell_app_system_lookup_heuristic_basename (ShellAppSystem *system,
                                            const char     *name)
{
  ShellApp *result;
  const char *const *prefix;

  result = shell_app_system_lookup_app (system, name);
  if (result != NULL)
    return result;

  for (prefix = vendor_prefixes; *prefix != NULL; prefix++)
    {
      char *tmpid = g_strconcat (*prefix, name, NULL);
      result = shell_app_system_lookup_app (system, tmpid);
      g_free (tmpid);
      if (result != NULL)
        return result;
    }

  return NULL;
}

/**
 * shell_app_system_lookup_alias:
 * @system: a #ShellAppSystem
 * @alias: alternative application id
 *
 * Find a valid application corresponding to a given
 * alias string, or %NULL if none.
 *
 * Returns: (transfer none): A #ShellApp for @alias
 */
ShellApp *
shell_app_system_lookup_alias (ShellAppSystem *system,
                               const char     *alias)
{
  ShellApp *result;
  const char *id;

  if (alias == NULL)
    return NULL;

  result = shell_app_system_lookup_app (system, alias);
  if (result != NULL)
    return result;

  id = g_hash_table_lookup (priv->alias_to_id, alias);
  if (id == NULL)
    return NULL;

  result = shell_app_system_lookup_app (system, id);

  return result;
}

static char *
canonicalize_and_sanitize_wmclass (const char *wmclass)
{
  char *canonicalized;

  canonicalized = g_ascii_strdown (wmclass, -1);

  /* This handles "Fedora Eclipse", probably others.
   * Note g_strdelimit is modify-in-place. */
  g_strdelimit (canonicalized, " ", '-');

  /* HACK: Handle GIMP here as a special case. */
  if (g_strcmp0 (canonicalized, "gimp-2.8") == 0)
    {
      g_free (canonicalized);
      canonicalized = g_strdup ("gimp");
    }

  return canonicalized;
}

/**
 * shell_app_system_lookup_desktop_wmclass:
 * @system: a #ShellAppSystem
 * @wmclass: (allow-none): A WM_CLASS value
 *
 * Find a valid application whose .desktop file, without the extension
 * and properly canonicalized, matches @wmclass.
 *
 * Returns: (transfer none): A #ShellApp for @wmclass
 */
ShellApp *
shell_app_system_lookup_desktop_wmclass (ShellAppSystem *system,
                                         const char     *wmclass)
{
  char *canonicalized;
  char *desktop_file;
  ShellApp *app;

  if (wmclass == NULL)
    return NULL;

  /* First try without changing the case (this handles
     org.example.Foo.Bar.desktop applications)

     Note that is slightly wrong in that Gtk+ would set
     the WM_CLASS to Org.example.Foo.Bar, but it also
     sets the instance part to org.example.Foo.Bar, so we're ok
  */
  desktop_file = g_strconcat (wmclass, ".desktop", NULL);
  app = shell_app_system_lookup_heuristic_basename (system, desktop_file);
  g_free (desktop_file);

  if (app)
    return app;

  canonicalized = canonicalize_and_sanitize_wmclass (wmclass);
  desktop_file = g_strconcat (canonicalized, ".desktop", NULL);

  app = shell_app_system_lookup_heuristic_basename (system, desktop_file);

  g_free (canonicalized);
  g_free (desktop_file);

  return app;
}

/**
 * shell_app_system_lookup_startup_wmclass:
 * @system: a #ShellAppSystem
 * @wmclass: (allow-none): A WM_CLASS value
 *
 * Find a valid application whose .desktop file contains a
 * StartupWMClass entry matching @wmclass.
 *
 * Returns: (transfer none): A #ShellApp for @wmclass
 */
ShellApp *
shell_app_system_lookup_startup_wmclass (ShellAppSystem *system,
                                         const char     *wmclass)
{
  const char *id;

  if (wmclass == NULL)
    return NULL;

  id = g_hash_table_lookup (system->priv->startup_wm_class_to_id, wmclass);
  if (id == NULL)
    return NULL;

  return shell_app_system_lookup_app (system, id);
}

void
_shell_app_system_notify_app_state_changed (ShellAppSystem *self,
                                            ShellApp       *app)
{
  ShellAppState state = shell_app_get_state (app);

  gchar *app_address = g_strdup_printf ("%p", app);
  GDesktopAppInfo *app_info = shell_app_get_app_info (app);
  const gchar *app_info_id = NULL;
  if (app_info != NULL) {
    app_info_id = g_app_info_get_id (G_APP_INFO (app_info));
  }

  switch (state)
    {
    case SHELL_APP_STATE_RUNNING:
      if (app_info_id != NULL)
      {
        emtr_event_recorder_record_start (emtr_event_recorder_get_default (),
                                          SHELL_APP_IS_OPEN_EVENT,
                                          g_variant_new ("s", app_address),
                                          g_variant_new ("s", app_info_id));
      }
      g_hash_table_insert (self->priv->running_apps, g_object_ref (app), NULL);
      g_hash_table_remove (self->priv->starting_apps, app);
      break;
    case SHELL_APP_STATE_STARTING:
      g_hash_table_insert (self->priv->starting_apps, g_object_ref (app), NULL);
      break;
    case SHELL_APP_STATE_STOPPED:
      g_hash_table_remove (self->priv->starting_apps, app);

      if (g_hash_table_remove (self->priv->running_apps, app) && app_info_id != NULL)
      {
        emtr_event_recorder_record_stop (emtr_event_recorder_get_default (),
                                         SHELL_APP_IS_OPEN_EVENT,
                                         g_variant_new ("s", app_address),
                                         NULL);
      }
      break;
    }
  g_free (app_address);

  g_signal_emit (self, signals[APP_STATE_CHANGED], 0, app);
}

/**
 * shell_app_system_get_running:
 * @self: A #ShellAppSystem
 *
 * Returns the set of applications which currently have at least one
 * open window in the given context.  The returned list will be sorted
 * by shell_app_compare().
 *
 * Returns: (element-type ShellApp) (transfer container): Active applications
 */
GSList *
shell_app_system_get_running (ShellAppSystem *self)
{
  gpointer key, value;
  GSList *ret = NULL;
  GHashTableIter iter;

  g_hash_table_iter_init (&iter, self->priv->running_apps);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      ShellApp *app = key;
      ret = g_slist_prepend (ret, app);
    }

  g_hash_table_iter_init (&iter, self->priv->starting_apps);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      ShellApp *app = key;
      ret = g_slist_prepend (ret, app);
    }

  ret = g_slist_sort (ret, (GCompareFunc)shell_app_compare);

  return ret;
}

gboolean
shell_app_system_has_starting_apps (ShellAppSystem *self)
{
  return g_hash_table_size (self->priv->starting_apps) > 0;
}
