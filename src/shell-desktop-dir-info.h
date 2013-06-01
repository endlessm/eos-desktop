/* EOS Shell desktop directory information
 *
 * Copyright © 2013 Endless Mobile, Inc.
 *
 * Based on https://git.gnome.org/browse/glib/tree/gio/gdesktopappinfo.h
 * Copyright (C) 2006-2007 Red Hat, Inc.
 *
 * This library is free software; you can redistribute it and/or
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

#ifndef __SHELL_DESKTOP_DIR_INFO_H__
#define __SHELL_DESKTOP_DIR_INFO_H__

#include <gio/gio.h>

G_BEGIN_DECLS

#define G_TYPE_DESKTOP_DIR_INFO         (g_desktop_dir_info_get_type ())
#define G_DESKTOP_DIR_INFO(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), G_TYPE_DESKTOP_DIR_INFO, GDesktopDirInfo))
#define G_DESKTOP_DIR_INFO_CLASS(k)     (G_TYPE_CHECK_CLASS_CAST((k), G_TYPE_DESKTOP_DIR_INFO, GDesktopDirInfoClass))
#define G_IS_DESKTOP_DIR_INFO(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), G_TYPE_DESKTOP_DIR_INFO))
#define G_IS_DESKTOP_DIR_INFO_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), G_TYPE_DESKTOP_DIR_INFO))
#define G_DESKTOP_DIR_INFO_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), G_TYPE_DESKTOP_DIR_INFO, GDesktopDirInfoClass))

typedef struct _GDesktopDirInfo        GDesktopDirInfo;
typedef struct _GDesktopDirInfoClass   GDesktopDirInfoClass;

struct _GDesktopDirInfoClass
{
  GObjectClass parent_class;
};


GLIB_AVAILABLE_IN_ALL
GType            g_desktop_dir_info_get_type          (void) G_GNUC_CONST;

GLIB_AVAILABLE_IN_ALL
GDesktopDirInfo *g_desktop_dir_info_new_from_filename (const char      *filename);

GLIB_AVAILABLE_IN_ALL
GDesktopDirInfo *g_desktop_dir_info_new_from_keyfile  (GKeyFile        *key_file);

GLIB_AVAILABLE_IN_ALL
const char *     g_desktop_dir_info_get_filename      (GDesktopDirInfo *info);

GLIB_AVAILABLE_IN_2_30
const char *     g_desktop_dir_info_get_generic_name  (GDesktopDirInfo *info);

GLIB_AVAILABLE_IN_2_30
gboolean         g_desktop_dir_info_get_nodisplay     (GDesktopDirInfo *info);

GLIB_AVAILABLE_IN_2_30
gboolean         g_desktop_dir_info_get_show_in       (GDesktopDirInfo *info,
                                                       const gchar     *desktop_env);

GLIB_AVAILABLE_IN_ALL
GDesktopDirInfo *g_desktop_dir_info_new               (const char      *desktop_id);

GLIB_AVAILABLE_IN_ALL
gboolean         g_desktop_dir_info_get_is_hidden     (GDesktopDirInfo *info);

GLIB_AVAILABLE_IN_ALL
void             g_desktop_dir_info_set_desktop_env   (const char      *desktop_env);

GLIB_AVAILABLE_IN_2_36
gboolean         g_desktop_dir_info_has_key           (GDesktopDirInfo *info,
                                                       const char      *key);

GLIB_AVAILABLE_IN_2_36
char *           g_desktop_dir_info_get_string        (GDesktopDirInfo *info,
                                                       const char      *key);

GLIB_AVAILABLE_IN_2_36
gboolean         g_desktop_dir_info_get_boolean       (GDesktopDirInfo *info,
                                                       const char      *key);


G_END_DECLS

#endif /* __SHELL_DESKTOP_DIR_INFO_H__ */
