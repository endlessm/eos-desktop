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

/* Vendor prefixes are something that can be preprended to a .desktop
 * file name.  Undo this.
 */
static const char*const vendor_prefixes[] = { "eos-app-",
                                              "gnome-",
                                              "fedora-",
                                              "mozilla-",
                                              "debian-",
                                              NULL };

enum {
   PROP_0,

};

enum {
  APP_STATE_CHANGED,
  INSTALLED_CHANGED,
  LAST_SIGNAL
};

static guint signals[LAST_SIGNAL] = { 0 };

struct _ShellAppSystemPrivate {
  GHashTable *running_apps;
  GHashTable *id_to_app;
  GHashTable *startup_wm_class_to_id;

  EmtrEventRecorder *event_recorder;
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

  g_type_class_add_private (gobject_class, sizeof (ShellAppSystemPrivate));
}

static void
shell_app_system_init (ShellAppSystem *self)
{
  ShellAppSystemPrivate *priv;

  self->priv = priv = G_TYPE_INSTANCE_GET_PRIVATE (self,
                                                   SHELL_TYPE_APP_SYSTEM,
                                                   ShellAppSystemPrivate);

  priv->running_apps = g_hash_table_new_full (NULL, NULL, (GDestroyNotify) g_object_unref, NULL);
  priv->id_to_app = g_hash_table_new_full (g_str_hash, g_str_equal,
                                           NULL,
                                           (GDestroyNotify)g_object_unref);

  priv->startup_wm_class_to_id = g_hash_table_new (g_str_hash, g_str_equal);

  priv->event_recorder = emtr_event_recorder_new ();
}

static void
shell_app_system_finalize (GObject *object)
{
  ShellAppSystem *self = SHELL_APP_SYSTEM (object);
  ShellAppSystemPrivate *priv = self->priv;

  g_hash_table_destroy (priv->running_apps);
  g_hash_table_destroy (priv->id_to_app);
  g_hash_table_destroy (priv->startup_wm_class_to_id);

  g_object_unref (priv->event_recorder);

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
  g_hash_table_insert (priv->id_to_app, shell_app_get_id (id), app);
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

  /* Lookup for vendor-prefixed desktop files first */
  for (prefix = vendor_prefixes; *prefix != NULL; prefix++)
    {
      char *tmpid = g_strconcat (*prefix, name, NULL);
      result = shell_app_system_lookup_app (system, tmpid);
      g_free (tmpid);
      if (result != NULL)
        return result;
    }

  /* Otherwise, just look for the desktop file as-is */
  result = shell_app_system_lookup_app (system, name);
  if (result != NULL)
    return result;

  return NULL;
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

  canonicalized = g_ascii_strdown (wmclass, -1);

  /* This handles "Fedora Eclipse", probably others.
   * Note g_strdelimit is modify-in-place. */
  g_strdelimit (canonicalized, " ", '-');

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
        emtr_event_recorder_record_start (self->priv->event_recorder, EMTR_EVENT_SHELL_APP_IS_OPEN, 
                                          g_variant_new ("s", app_address), 
                                          g_variant_new ("s", app_info_id));
      }
      g_hash_table_insert (self->priv->running_apps, g_object_ref (app), NULL);
      break;
    case SHELL_APP_STATE_STARTING:
      break;
    case SHELL_APP_STATE_STOPPED:
      if (app_info_id != NULL) 
      {
        emtr_event_recorder_record_stop (self->priv->event_recorder, EMTR_EVENT_SHELL_APP_IS_OPEN, 
                                         g_variant_new ("s", app_address),
                                         NULL);
      }
      g_hash_table_remove (self->priv->running_apps, app);
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
  GSList *ret;
  GHashTableIter iter;

  g_hash_table_iter_init (&iter, self->priv->running_apps);

  ret = NULL;
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      ShellApp *app = key;

      ret = g_slist_prepend (ret, app);
    }

  ret = g_slist_sort (ret, (GCompareFunc)shell_app_compare);

  return ret;
}


static gint
compare_apps_by_usage (gconstpointer a,
                       gconstpointer b,
                       gpointer      data)
{
  ShellAppUsage *usage = shell_app_usage_get_default ();

  ShellApp *app_a = (ShellApp*)a;
  ShellApp *app_b = (ShellApp*)b;

  return shell_app_usage_compare (usage, "", app_a, app_b);
}

static GSList *
sort_and_concat_results (ShellAppSystem *system,
                         GSList         *prefix_matches,
                         GSList         *substring_matches)
{
  prefix_matches = g_slist_sort_with_data (prefix_matches,
                                           compare_apps_by_usage,
                                           system);
  substring_matches = g_slist_sort_with_data (substring_matches,
                                              compare_apps_by_usage,
                                              system);
  return g_slist_concat (prefix_matches, substring_matches);
}

/**
 * normalize_terms:
 * @terms: (element-type utf8): Input search terms
 *
 * Returns: (element-type utf8) (transfer full): Unicode-normalized and lowercased terms
 */
static GSList *
normalize_terms (GSList *terms)
{
  GSList *normalized_terms = NULL;
  GSList *iter;
  for (iter = terms; iter; iter = iter->next)
    {
      const char *term = iter->data;
      normalized_terms = g_slist_prepend (normalized_terms,
                                          shell_util_normalize_casefold_and_unaccent (term));
    }
  return normalized_terms;
}

static GSList *
search_tree (ShellAppSystem *self,
             GSList         *terms,
             GHashTable     *apps)
{
  GSList *prefix_results = NULL;
  GSList *substring_results = NULL;
  GSList *normalized_terms;
  GHashTableIter iter;
  gpointer key, value;

  normalized_terms = normalize_terms (terms);

  g_hash_table_iter_init (&iter, apps);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      const char *id = key;
      ShellApp *app = value;
      (void)id;
      _shell_app_do_match (app, normalized_terms,
                           &prefix_results,
                           &substring_results);
    }
  g_slist_free_full (normalized_terms, g_free);

  return sort_and_concat_results (self, prefix_results, substring_results);

}

/**
 * shell_app_system_initial_search:
 * @system: A #ShellAppSystem
 * @terms: (element-type utf8): List of terms, logical AND
 *
 * Search through applications for the given search terms.
 *
 * Returns: (transfer container) (element-type ShellApp): List of applications
 */
GSList *
shell_app_system_initial_search (ShellAppSystem  *self,
                                 GSList          *terms)
{
  return search_tree (self, terms, self->priv->id_to_app);
}

/**
 * shell_app_system_subsearch:
 * @system: A #ShellAppSystem
 * @previous_results: (element-type ShellApp): List of previous results
 * @terms: (element-type utf8): List of terms, logical AND
 *
 * Search through a previous result set; for more information, see
 * js/ui/search.js.  Note the value of @prefs must be
 * the same as passed to shell_app_system_initial_search().  Note that returned
 * strings are only valid until a return to the main loop.
 *
 * Returns: (transfer container) (element-type ShellApp): List of application identifiers
 */
GSList *
shell_app_system_subsearch (ShellAppSystem   *system,
                            GSList           *previous_results,
                            GSList           *terms)
{
  GSList *iter;
  GSList *prefix_results = NULL;
  GSList *substring_results = NULL;
  GSList *normalized_terms = normalize_terms (terms);

  previous_results = g_slist_reverse (previous_results);

  for (iter = previous_results; iter; iter = iter->next)
    {
      ShellApp *app = iter->data;
      
      _shell_app_do_match (app, normalized_terms,
                           &prefix_results,
                           &substring_results);
    }
  g_slist_free_full (normalized_terms, g_free);

  /* Note that a shorter term might have matched as a prefix, but
     when extended only as a substring, so we have to redo the
     sort rather than reusing the existing ordering */
  return sort_and_concat_results (system, prefix_results, substring_results);
}

