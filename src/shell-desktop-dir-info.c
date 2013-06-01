/* EOS Shell desktop directory information
 *
 * Copyright © 2013 Endless Mobile, Inc.
 *
 * Based on https://git.gnome.org/browse/glib/tree/gio/gdesktopappinfo.c
 * Copyright (C) 2006-2007 Red Hat, Inc.
 * Copyright © 2007 Ryan Lortie
 * * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, write to the
 * Free Software Foundation, Inc., 59 Temple Place, Suite 330,
 * Boston, MA 02111-1307, USA.
 */

#include "config.h"

#include <errno.h>
#include <string.h>
#include <unistd.h>

#ifdef HAVE_CRT_EXTERNS_H
#include <crt_externs.h>
#endif

#include "shell-desktop-dir-info.h"
#include "shell-dir-info.h"

#include <glib.h>
#include <glib/gi18n.h>


/**
 * SECTION:gdesktopdirinfo
 * @title: GDesktopDirInfo
 * @short_description: Directory information from desktop files
 * @include: gio/gdesktopdirinfo.h
 *
 * #GDesktopDirInfo is an implementation of #GDirInfo based on
 * desktop files.
 *
 * Note that <filename>&lt;gio/gdesktopdirinfo.h&gt;</filename> belongs to
 * the UNIX-specific GIO interfaces, thus you have to use the
 * <filename>gio-unix-2.0.pc</filename> pkg-config file when using it.
 */

#define GENERIC_NAME_KEY            "GenericName"
#define FULL_NAME_KEY               "X-GNOME-FullName"

enum {
  PROP_0,
  PROP_FILENAME
};

static void     g_desktop_dir_info_iface_init         (GDirInfoIface    *iface);
static gboolean g_desktop_dir_info_ensure_saved       (GDesktopDirInfo  *info,
						       GError          **error);

/**
 * GDesktopDirInfo:
 * 
 * Information about a desktop directory from a desktop file.
 */
struct _GDesktopDirInfo
{
  GObject parent_instance;

  char *desktop_id;
  char *filename;

  GKeyFile *keyfile;

  char *name;
  char *generic_name;
  char *fullname;
  char *comment;
  char *icon_name;
  GIcon *icon;
  char **only_show_in;
  char **not_show_in;

  guint nodisplay       : 1;
  guint hidden          : 1;
};

G_DEFINE_TYPE_WITH_CODE (GDesktopDirInfo, g_desktop_dir_info, G_TYPE_OBJECT,
			 G_IMPLEMENT_INTERFACE (G_TYPE_DIR_INFO,
						g_desktop_dir_info_iface_init))

G_LOCK_DEFINE_STATIC (g_desktop_env);
static gchar *g_desktop_env = NULL;

static gpointer
search_path_init (gpointer data)
{
  char **args = NULL;
  const char * const *data_dirs;
  const char *user_data_dir;
  int i, length, j;

  data_dirs = g_get_system_data_dirs ();
  length = g_strv_length ((char **) data_dirs);
  
  args = g_new (char *, length + 2);
  
  j = 0;
  user_data_dir = g_get_user_data_dir ();
  args[j++] = g_build_filename (user_data_dir, "desktop-directories", NULL);
  for (i = 0; i < length; i++)
    args[j++] = g_build_filename (data_dirs[i],
				  "desktop-directories", NULL);
  args[j++] = NULL;
  
  return args;
}
  
static const char * const *
get_directories_search_path (void)
{
  static GOnce once_init = G_ONCE_INIT;
  return g_once (&once_init, search_path_init, NULL);
}

static void
g_desktop_dir_info_finalize (GObject *object)
{
  GDesktopDirInfo *info;

  info = G_DESKTOP_DIR_INFO (object);

  g_free (info->desktop_id);
  g_free (info->filename);

  if (info->keyfile)
    g_key_file_unref (info->keyfile);

  g_free (info->name);
  g_free (info->generic_name);
  g_free (info->fullname);
  g_free (info->comment);
  g_free (info->icon_name);
  if (info->icon)
    g_object_unref (info->icon);
  g_strfreev (info->only_show_in);
  g_strfreev (info->not_show_in);
  
  G_OBJECT_CLASS (g_desktop_dir_info_parent_class)->finalize (object);
}

static void
g_desktop_dir_info_set_property(GObject         *object,
				guint            prop_id,
				const GValue    *value,
				GParamSpec      *pspec)
{
  GDesktopDirInfo *self = G_DESKTOP_DIR_INFO (object);

  switch (prop_id)
    {
    case PROP_FILENAME:
      self->filename = g_value_dup_string (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
g_desktop_dir_info_get_property (GObject    *object,
                                 guint       prop_id,
                                 GValue     *value,
                                 GParamSpec *pspec)
{
  GDesktopDirInfo *self = G_DESKTOP_DIR_INFO (object);

  switch (prop_id)
    {
    case PROP_FILENAME:
      g_value_set_string (value, self->filename);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
g_desktop_dir_info_class_init (GDesktopDirInfoClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  
  gobject_class->get_property = g_desktop_dir_info_get_property;
  gobject_class->set_property = g_desktop_dir_info_set_property;
  gobject_class->finalize = g_desktop_dir_info_finalize;

  /**
   * GDesktopDirInfo:filename:
   *
   * The origin filename of this #GDesktopDirInfo
   */
  g_object_class_install_property (gobject_class,
                                   PROP_FILENAME,
                                   g_param_spec_string ("filename", "Filename", "",
							NULL,
                                                        G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY));
}

static void
g_desktop_dir_info_init (GDesktopDirInfo *local)
{
}

static gboolean
g_desktop_dir_info_load_from_keyfile (GDesktopDirInfo *info, 
				      GKeyFile        *key_file)
{
  char *start_group;
  char *type;

  start_group = g_key_file_get_start_group (key_file);
  if (start_group == NULL || strcmp (start_group, G_KEY_FILE_DESKTOP_GROUP) != 0)
    {
      g_free (start_group);
      return FALSE;
    }
  g_free (start_group);

  type = g_key_file_get_string (key_file,
                                G_KEY_FILE_DESKTOP_GROUP,
                                G_KEY_FILE_DESKTOP_KEY_TYPE,
                                NULL);
  if (type == NULL || strcmp (type, G_KEY_FILE_DESKTOP_TYPE_DIRECTORY) != 0)
    {
      g_free (type);
      return FALSE;
    }
  g_free (type);

  info->name = g_key_file_get_locale_string (key_file, G_KEY_FILE_DESKTOP_GROUP, G_KEY_FILE_DESKTOP_KEY_NAME, NULL, NULL);
  info->generic_name = g_key_file_get_locale_string (key_file, G_KEY_FILE_DESKTOP_GROUP, GENERIC_NAME_KEY, NULL, NULL);
  info->fullname = g_key_file_get_locale_string (key_file, G_KEY_FILE_DESKTOP_GROUP, FULL_NAME_KEY, NULL, NULL);
  info->comment = g_key_file_get_locale_string (key_file, G_KEY_FILE_DESKTOP_GROUP, G_KEY_FILE_DESKTOP_KEY_COMMENT, NULL, NULL);
  info->nodisplay = g_key_file_get_boolean (key_file, G_KEY_FILE_DESKTOP_GROUP, G_KEY_FILE_DESKTOP_KEY_NO_DISPLAY, NULL) != FALSE;
  info->icon_name =  g_key_file_get_locale_string (key_file, G_KEY_FILE_DESKTOP_GROUP, G_KEY_FILE_DESKTOP_KEY_ICON, NULL, NULL);
  info->only_show_in = g_key_file_get_string_list (key_file, G_KEY_FILE_DESKTOP_GROUP, G_KEY_FILE_DESKTOP_KEY_ONLY_SHOW_IN, NULL, NULL);
  info->not_show_in = g_key_file_get_string_list (key_file, G_KEY_FILE_DESKTOP_GROUP, G_KEY_FILE_DESKTOP_KEY_NOT_SHOW_IN, NULL, NULL);
  info->hidden = g_key_file_get_boolean (key_file, G_KEY_FILE_DESKTOP_GROUP, G_KEY_FILE_DESKTOP_KEY_HIDDEN, NULL) != FALSE;
  
  info->icon = NULL;
  if (info->icon_name)
    {
      if (g_path_is_absolute (info->icon_name))
	{
	  GFile *file;
	  
	  file = g_file_new_for_path (info->icon_name);
	  info->icon = g_file_icon_new (file);
	  g_object_unref (file);
	}
      else
        {
          char *p;

          /* Work around a common mistake in desktop files */    
          if ((p = strrchr (info->icon_name, '.')) != NULL &&
              (strcmp (p, ".png") == 0 ||
               strcmp (p, ".xpm") == 0 ||
               strcmp (p, ".svg") == 0)) 
            *p = 0;

	  info->icon = g_themed_icon_new (info->icon_name);
        }
    }
  
  info->keyfile = g_key_file_ref (key_file);

  return TRUE;
}

static gboolean
g_desktop_dir_info_load_file (GDesktopDirInfo *self)
{
  GKeyFile *key_file;
  gboolean retval = FALSE;

  g_return_val_if_fail (self->filename != NULL, FALSE);

  self->desktop_id = g_path_get_basename (self->filename);

  key_file = g_key_file_new ();

  if (g_key_file_load_from_file (key_file,
				 self->filename,
				 G_KEY_FILE_NONE,
				 NULL))
    {
      retval = g_desktop_dir_info_load_from_keyfile (self, key_file);
    }

  g_key_file_unref (key_file);
  return retval;
}

/**
 * g_desktop_dir_info_new_from_keyfile:
 * @key_file: an opened #GKeyFile
 *
 * Creates a new #GDesktopDirInfo.
 *
 * Returns: a new #GDesktopDirInfo or %NULL on error.
 *
 * Since: 2.18
 **/
GDesktopDirInfo *
g_desktop_dir_info_new_from_keyfile (GKeyFile *key_file)
{
  GDesktopDirInfo *info;

  info = g_object_new (G_TYPE_DESKTOP_DIR_INFO, NULL);
  info->filename = NULL;
  if (!g_desktop_dir_info_load_from_keyfile (info, key_file))
    {
      g_object_unref (info);
      return NULL;
    }
  return info;
}

/**
 * g_desktop_dir_info_new_from_filename:
 * @filename: the path of a desktop file, in the GLib filename encoding
 * 
 * Creates a new #GDesktopDirInfo.
 *
 * Returns: a new #GDesktopDirInfo or %NULL on error.
 **/
GDesktopDirInfo *
g_desktop_dir_info_new_from_filename (const char *filename)
{
  GDesktopDirInfo *info = NULL;

  info = g_object_new (G_TYPE_DESKTOP_DIR_INFO, "filename", filename, NULL);
  if (!g_desktop_dir_info_load_file (info))
    {
      g_object_unref (info);
      return NULL;
    }
  return info;
}

/**
 * g_desktop_dir_info_new:
 * @desktop_id: the desktop file id
 * 
 * Creates a new #GDesktopDirInfo based on a desktop file id. 
 *
 * A desktop file id is the basename of the desktop file, including the 
 * .directory extension. GIO is looking for a desktop file with this name 
 * in the <filename>desktop-directories</filename> subdirectories of the XDG data
 * directories (i.e. the directories specified in the 
 * <envar>XDG_DATA_HOME</envar> and <envar>XDG_DATA_DIRS</envar> environment 
 * variables). GIO also supports the prefix-to-subdirectory mapping that is
 * described in the <ulink url="http://standards.freedesktop.org/menu-spec/latest/">Menu Spec</ulink> 
 * (i.e. a desktop id of kde-foo.directory will match
 * <filename>/usr/share/desktop-directories/kde/foo.directory</filename>).
 * 
 * Returns: a new #GDesktopDirInfo, or %NULL if no desktop file with that id
 */
GDesktopDirInfo *
g_desktop_dir_info_new (const char *desktop_id)
{
  GDesktopDirInfo *dirinfo;
  const char * const *dirs;
  char *basename;
  int i;

  dirs = get_directories_search_path ();

  basename = g_strdup (desktop_id);
  
  for (i = 0; dirs[i] != NULL; i++)
    {
      char *filename;
      char *p;

      filename = g_build_filename (dirs[i], desktop_id, NULL);
      dirinfo = g_desktop_dir_info_new_from_filename (filename);
      g_free (filename);
      if (dirinfo != NULL)
	goto found;

      p = basename;
      while ((p = strchr (p, '-')) != NULL)
	{
	  *p = '/';

	  filename = g_build_filename (dirs[i], basename, NULL);
	  dirinfo = g_desktop_dir_info_new_from_filename (filename);
	  g_free (filename);
	  if (dirinfo != NULL)
	    goto found;
	  *p = '-';
	  p++;
	}
    }

  g_free (basename);
  return NULL;

 found:
  g_free (basename);
  
  g_free (dirinfo->desktop_id);
  dirinfo->desktop_id = g_strdup (desktop_id);

  if (g_desktop_dir_info_get_is_hidden (dirinfo))
    {
      g_object_unref (dirinfo);
      dirinfo = NULL;
    }
  
  return dirinfo;
}

static GDirInfo *
g_desktop_dir_info_dup (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);
  GDesktopDirInfo *new_info;
  
  new_info = g_object_new (G_TYPE_DESKTOP_DIR_INFO, NULL);

  new_info->filename = g_strdup (info->filename);
  new_info->desktop_id = g_strdup (info->desktop_id);

  if (info->keyfile)
    new_info->keyfile = g_key_file_ref (info->keyfile);

  new_info->name = g_strdup (info->name);
  new_info->generic_name = g_strdup (info->generic_name);
  new_info->fullname = g_strdup (info->fullname);
  new_info->comment = g_strdup (info->comment);
  new_info->nodisplay = info->nodisplay;
  new_info->icon_name = g_strdup (info->icon_name);
  if (info->icon)
    new_info->icon = g_object_ref (info->icon);
  new_info->only_show_in = g_strdupv (info->only_show_in);
  new_info->not_show_in = g_strdupv (info->not_show_in);
  new_info->hidden = info->hidden;
  
  return G_DIR_INFO (new_info);
}

static gboolean
g_desktop_dir_info_equal (GDirInfo *dirinfo1,
			  GDirInfo *dirinfo2)
{
  GDesktopDirInfo *info1 = G_DESKTOP_DIR_INFO (dirinfo1);
  GDesktopDirInfo *info2 = G_DESKTOP_DIR_INFO (dirinfo2);

  if (info1->desktop_id == NULL ||
      info2->desktop_id == NULL)
    return info1 == info2;

  return strcmp (info1->desktop_id, info2->desktop_id) == 0;
}

static const char *
g_desktop_dir_info_get_id (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);

  return info->desktop_id;
}

static const char *
g_desktop_dir_info_get_name (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);

  if (info->name == NULL)
    return _("Unnamed");
  return info->name;
}

static const char *
g_desktop_dir_info_get_display_name (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);

  if (info->fullname == NULL)
    return g_desktop_dir_info_get_name (dirinfo);
  return info->fullname;
}

/**
 * g_desktop_dir_info_get_is_hidden:
 * @info: a #GDesktopDirInfo.
 *
 * A desktop file is hidden if the Hidden key in it is
 * set to True.
 *
 * Returns: %TRUE if hidden, %FALSE otherwise. 
 **/
gboolean
g_desktop_dir_info_get_is_hidden (GDesktopDirInfo *info)
{
  return info->hidden;
}

/**
 * g_desktop_dir_info_get_filename:
 * @info: a #GDesktopDirInfo
 *
 * When @info was created from a known filename, return it.  In some
 * situations such as the #GDesktopDirInfo returned from
 * g_desktop_dir_info_new_from_keyfile(), this function will return %NULL.
 *
 * Returns: The full path to the file for @info, or %NULL if not known.
 * Since: 2.24
 */
const char *
g_desktop_dir_info_get_filename (GDesktopDirInfo *info)
{
  return info->filename;
}

static const char *
g_desktop_dir_info_get_description (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);
  
  return info->comment;
}

static GIcon *
g_desktop_dir_info_get_icon (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);

  return info->icon;
}

/**
 * g_desktop_dir_info_get_generic_name:
 * @info: a #GDesktopDirInfo
 *
 * Gets the generic name from the destkop file.
 *
 * Returns: The value of the GenericName key
 */
const char *
g_desktop_dir_info_get_generic_name (GDesktopDirInfo *info)
{
  return info->generic_name;
}

/**
 * g_desktop_dir_info_get_nodisplay:
 * @info: a #GDesktopDirInfo
 *
 * Gets the value of the NoDisplay key, which helps determine if the
 * directory info should be shown in menus. See
 * #G_KEY_FILE_DESKTOP_KEY_NO_DISPLAY and g_dir_info_should_show().
 *
 * Returns: The value of the NoDisplay key
 *
 * Since: 2.30
 */
gboolean
g_desktop_dir_info_get_nodisplay (GDesktopDirInfo *info)
{
  return info->nodisplay;
}

/**
 * g_desktop_dir_info_get_show_in:
 * @info: a #GDesktopDirInfo
 * @desktop_env: a string specifying a desktop name
 *
 * Checks if the directory info should be shown in menus that list available
 * directories for a specific name of the desktop, based on the
 * <literal>OnlyShowIn</literal> and <literal>NotShowIn</literal> keys.
 *
 * If @desktop_env is %NULL, then the name of the desktop set with
 * g_desktop_dir_info_set_desktop_env() is used.
 *
 * Note that g_dir_info_should_show() for @info will include this check (with
 * %NULL for @desktop_env) as well as additional checks.
 *
 * Returns: %TRUE if the @info should be shown in @desktop_env according to the
 * <literal>OnlyShowIn</literal> and <literal>NotShowIn</literal> keys, %FALSE
 * otherwise.
 *
 * Since: 2.30
 */
gboolean
g_desktop_dir_info_get_show_in (GDesktopDirInfo *info,
                                const gchar     *desktop_env)
{
  gboolean found;
  int i;

  g_return_val_if_fail (G_IS_DESKTOP_DIR_INFO (info), FALSE);

  if (!desktop_env) {
    G_LOCK (g_desktop_env);
    desktop_env = g_desktop_env;
    G_UNLOCK (g_desktop_env);
  }

  if (info->only_show_in)
    {
      if (desktop_env == NULL)
	return FALSE;

      found = FALSE;
      for (i = 0; info->only_show_in[i] != NULL; i++)
	{
	  if (strcmp (info->only_show_in[i], desktop_env) == 0)
	    {
	      found = TRUE;
	      break;
	    }
	}
      if (!found)
	return FALSE;
    }

  if (info->not_show_in && desktop_env)
    {
      for (i = 0; info->not_show_in[i] != NULL; i++)
	{
	  if (strcmp (info->not_show_in[i], desktop_env) == 0)
	    return FALSE;
	}
    }

  return TRUE;
}

static gboolean
g_desktop_dir_info_should_show (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);

  if (info->nodisplay)
    return FALSE;

  return g_desktop_dir_info_get_show_in (info, NULL);
}

static char *
ensure_dir (GError  **error)
{
  char *path, *display_name;
  int errsv;

  path = g_build_filename (g_get_user_data_dir (), "desktop-directories", NULL);

  errno = 0;
  if (g_mkdir_with_parents (path, 0700) == 0)
    return path;

  errsv = errno;
  display_name = g_filename_display_name (path);
  g_set_error (error, G_IO_ERROR, g_io_error_from_errno (errsv),
               _("Can't create user directory configuration folder %s: %s"),
               display_name, g_strerror (errsv));

  g_free (display_name);
  g_free (path);

  return NULL;
}

static gboolean
g_desktop_dir_info_ensure_saved (GDesktopDirInfo  *info,
				 GError          **error)
{
  GKeyFile *key_file;
  char *dirname;
  char *filename;
  char *data, *desktop_id;
  gsize data_size;
  int fd;
  gboolean res;
  
  if (info->filename != NULL)
    return TRUE;

  /* This is only used for object created with
   * g_dir_info_create_from_directory_name. All other
   * object should have a filename
   */
  
  dirname = ensure_dir (error);
  if (!dirname)
    return FALSE;
  
  key_file = g_key_file_new ();

  g_key_file_set_string (key_file, G_KEY_FILE_DESKTOP_GROUP,
			 "Encoding", "UTF-8");
  g_key_file_set_string (key_file, G_KEY_FILE_DESKTOP_GROUP,
			 G_KEY_FILE_DESKTOP_KEY_VERSION, "1.0");
  g_key_file_set_string (key_file, G_KEY_FILE_DESKTOP_GROUP,
			 G_KEY_FILE_DESKTOP_KEY_TYPE,
                         G_KEY_FILE_DESKTOP_TYPE_DIRECTORY);
  if (info->nodisplay)
    g_key_file_set_boolean (key_file, G_KEY_FILE_DESKTOP_GROUP,
			    G_KEY_FILE_DESKTOP_KEY_NO_DISPLAY, TRUE);

  g_key_file_set_string (key_file, G_KEY_FILE_DESKTOP_GROUP,
			 G_KEY_FILE_DESKTOP_KEY_NAME, info->name);

  if (info->generic_name != NULL)
    g_key_file_set_string (key_file, G_KEY_FILE_DESKTOP_GROUP,
			   GENERIC_NAME_KEY, info->generic_name);

  if (info->fullname != NULL)
    g_key_file_set_string (key_file, G_KEY_FILE_DESKTOP_GROUP,
			   FULL_NAME_KEY, info->fullname);

  g_key_file_set_string (key_file, G_KEY_FILE_DESKTOP_GROUP,
			 G_KEY_FILE_DESKTOP_KEY_COMMENT, info->comment);
  
  g_key_file_set_boolean (key_file, G_KEY_FILE_DESKTOP_GROUP,
			  G_KEY_FILE_DESKTOP_KEY_NO_DISPLAY, TRUE);

  data = g_key_file_to_data (key_file, &data_size, NULL);
  g_key_file_free (key_file);

  desktop_id = g_strdup_printf ("userdir-%s-XXXXXX.directory", info->name);
  filename = g_build_filename (dirname, desktop_id, NULL);
  g_free (desktop_id);
  g_free (dirname);
  
  fd = g_mkstemp (filename);
  if (fd == -1)
    {
      char *display_name;

      display_name = g_filename_display_name (filename);
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED,
		   _("Can't create user desktop file %s"), display_name);
      g_free (display_name);
      g_free (filename);
      g_free (data);
      return FALSE;
    }

  desktop_id = g_path_get_basename (filename);

  /* FIXME - actually handle error */
  (void) g_close (fd, NULL);
  
  res = g_file_set_contents (filename, data, data_size, error);
  g_free (data);
  if (!res)
    {
      g_free (desktop_id);
      g_free (filename);
      return FALSE;
    }

  info->filename = filename;
  info->desktop_id = desktop_id;
  
  run_update_command ("update-desktop-database", "desktop-directories");
  
  return TRUE;
}

static gboolean
g_desktop_dir_info_can_delete (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);

  if (info->filename)
    {
      if (strstr (info->filename, "/userdir-"))
        return g_access (info->filename, W_OK) == 0;
    }

  return FALSE;
}

static gboolean
g_desktop_dir_info_delete (GDirInfo *dirinfo)
{
  GDesktopDirInfo *info = G_DESKTOP_DIR_INFO (dirinfo);
  
  if (info->filename)
    { 
      if (g_remove (info->filename) == 0)
        {
          g_free (info->filename);
          info->filename = NULL;
          g_free (info->desktop_id);
          info->desktop_id = NULL;

          return TRUE;
        }
    }

  return FALSE;
}

/**
 * g_dir_info_create_from_directory_name:
 * @directory_name: the directory name
 * @flags: flags that can specify details of the created #GDirInfo
 * @error: a #GError location to store the error occurring, %NULL to ignore.
 *
 * Creates a new #GDirInfo from the given information.
 *
 * Returns: (transfer full): new #GDirInfo for given directory name.
 **/
GDirInfo *
g_dir_info_create_from_directory_name (const char           *directory_name,
				       GError              **error)
{
  char **split;
  char *basename;
  GDesktopDirInfo *info;

  g_return_val_if_fail (directory_name, NULL);

  info = g_object_new (G_TYPE_DESKTOP_DIR_INFO, NULL);

  info->filename = NULL;
  info->desktop_id = NULL;
  
  info->hidden = FALSE;
  info->nodisplay = TRUE;
  
  info->name = g_strdup (directory_name);
  info->comment = g_strdup_printf (_("Custom definition for %s"), info->name);
  
  return G_DIR_INFO (info);
}

static void
g_desktop_dir_info_iface_init (GDirInfoIface *iface)
{
  iface->dup = g_desktop_dir_info_dup;
  iface->equal = g_desktop_dir_info_equal;
  iface->get_id = g_desktop_dir_info_get_id;
  iface->get_name = g_desktop_dir_info_get_name;
  iface->get_description = g_desktop_dir_info_get_description;
  iface->get_icon = g_desktop_dir_info_get_icon;
  iface->should_show = g_desktop_dir_info_should_show;
  iface->can_delete = g_desktop_dir_info_can_delete;
  iface->do_delete = g_desktop_dir_info_delete;
  iface->get_display_name = g_desktop_dir_info_get_display_name;
}

static gboolean
dir_info_in_list (GDirInfo *info, 
                  GList    *list)
{
  while (list != NULL)
    {
      if (g_dir_info_equal (info, list->data))
	return TRUE;
      list = list->next;
    }
  return FALSE;
}

static void
get_entries_from_dir (GHashTable *entries, 
		      const char *dirname, 
		      const char *prefix)
{
  GDir *dir;
  const char *basename;
  char *filename, *subprefix, *desktop_id;
  gboolean hidden;
  GDesktopDirInfo *dirinfo;
  
  dir = g_dir_open (dirname, 0, NULL);
  if (dir)
    {
      while ((basename = g_dir_read_name (dir)) != NULL)
	{
	  filename = g_build_filename (dirname, basename, NULL);
	  if (g_str_has_suffix (basename, ".directory"))
	    {
	      desktop_id = g_strconcat (prefix, basename, NULL);

	      /* Use _extended so we catch NULLs too (hidden) */
	      if (!g_hash_table_lookup_extended (entries, desktop_id, NULL, NULL))
		{
		  dirinfo = g_desktop_dir_info_new_from_filename (filename);
                  hidden = FALSE;

		  if (dirinfo && g_desktop_dir_info_get_is_hidden (dirinfo))
		    {
		      g_object_unref (dirinfo);
		      dirinfo = NULL;
		      hidden = TRUE;
		    }
				      
		  if (dirinfo || hidden)
		    {
		      g_hash_table_insert (entries, g_strdup (desktop_id), dirinfo);

		      if (dirinfo)
			{
			  /* Reuse instead of strdup here */
			  dirinfo->desktop_id = desktop_id;
			  desktop_id = NULL;
			}
		    }
		}
	      g_free (desktop_id);
	    }
	  else
	    {
	      if (g_file_test (filename, G_FILE_TEST_IS_DIR))
		{
		  subprefix = g_strconcat (prefix, basename, "-", NULL);
		  get_entries_from_dir (entries, filename, subprefix);
		  g_free (subprefix);
		}
	    }
	  g_free (filename);
	}
      g_dir_close (dir);
    }
}


/**
 * g_dir_info_get_all:
 *
 * Gets a list of all of the desktop directories currently registered 
 * on this system.
 * 
 * For desktop files, this includes directories that have 
 * <literal>NoDisplay=true</literal> set or are excluded from 
 * display by means of <literal>OnlyShowIn</literal> or
 * <literal>NotShowIn</literal>. See g_dir_info_should_show().
 * The returned list does not include directories which have
 * the <literal>Hidden</literal> key set. 
 * 
 * Returns: (element-type GDirInfo) (transfer full): a newly allocated #GList of references to #GDirInfo<!---->s.
 **/
GList *
g_dir_info_get_all (void)
{
  const char * const *dirs;
  GHashTable *entries;
  GHashTableIter iter;
  gpointer value;
  int i;
  GList *infos;

  dirs = get_directories_search_path ();

  entries = g_hash_table_new_full (g_str_hash, g_str_equal,
				   g_free, NULL);

  
  for (i = 0; dirs[i] != NULL; i++)
    get_entries_from_dir (entries, dirs[i], "");


  infos = NULL;
  g_hash_table_iter_init (&iter, entries);
  while (g_hash_table_iter_next (&iter, NULL, &value))
    {
      if (value)
        infos = g_list_prepend (infos, value);
    }

  g_hash_table_destroy (entries);

  return g_list_reverse (infos);
}

static GList *
append_desktop_entry (GList      *list, 
                      const char *desktop_entry,
		      GList      *removed_entries)
{
  /* Add if not already in list, and valid */
  if (!g_list_find_custom (list, desktop_entry, (GCompareFunc) strcmp) &&
      !g_list_find_custom (removed_entries, desktop_entry, (GCompareFunc) strcmp))
    list = g_list_prepend (list, g_strdup (desktop_entry));
  
  return list;
}

/**
 * g_desktop_dir_info_get_string:
 * @info: a #GDesktopDirInfo
 * @key: the key to look up
 *
 * Looks up a string value in the keyfile backing @info.
 *
 * The @key is looked up in the "Desktop Entry" group.
 *
 * Returns: a newly allocated string, or %NULL if the key
 *     is not found
 *
 * Since: 2.36
 */
char *
g_desktop_dir_info_get_string (GDesktopDirInfo *info,
                               const char      *key)
{
  g_return_val_if_fail (G_IS_DESKTOP_DIR_INFO (info), NULL);

  return g_key_file_get_string (info->keyfile,
                                G_KEY_FILE_DESKTOP_GROUP, key, NULL);
}

/**
 * g_desktop_dir_info_get_boolean:
 * @info: a #GDesktopDirInfo
 * @key: the key to look up
 *
 * Looks up a boolean value in the keyfile backing @info.
 *
 * The @key is looked up in the "Desktop Entry" group.
 *
 * Returns: the boolean value, or %FALSE if the key
 *     is not found
 *
 * Since: 2.36
 */
gboolean
g_desktop_dir_info_get_boolean (GDesktopDirInfo *info,
                                const char      *key)
{
  g_return_val_if_fail (G_IS_DESKTOP_DIR_INFO (info), FALSE);

  return g_key_file_get_boolean (info->keyfile,
                                 G_KEY_FILE_DESKTOP_GROUP, key, NULL);
}

/**
 * g_desktop_dir_info_has_key:
 * @info: a #GDesktopDirInfo
 * @key: the key to look up
 *
 * Returns whether @key exists in the "Desktop Entry" group
 * of the keyfile backing @info.
 *
 * Returns: %TRUE if the @key exists
 *
 * Since: 2.26
 */
gboolean
g_desktop_dir_info_has_key (GDesktopDirInfo *info,
                            const char      *key)
{
  g_return_val_if_fail (G_IS_DESKTOP_DIR_INFO (info), FALSE);

  return g_key_file_has_key (info->keyfile,
                             G_KEY_FILE_DESKTOP_GROUP, key, NULL);
}
