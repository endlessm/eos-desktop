/* EOS Shell directory information
 *
 * Copyright © 2013 Endless Mobile, Inc.
 *
 * Based on https://git.gnome.org/browse/glib/tree/gio/gappinfo.h
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

#ifndef __G_DIR_INFO_H__
#define __G_DIR_INFO_H__

#include <gio/gio.h>

G_BEGIN_DECLS

#define G_TYPE_DIR_INFO            (g_dir_info_get_type ())
#define G_DIR_INFO(obj)            (G_TYPE_CHECK_INSTANCE_CAST ((obj), G_TYPE_DIR_INFO, GDirInfo))
#define G_IS_DIR_INFO(obj)         (G_TYPE_CHECK_INSTANCE_TYPE ((obj), G_TYPE_DIR_INFO))
#define G_DIR_INFO_GET_IFACE(obj)  (G_TYPE_INSTANCE_GET_INTERFACE ((obj), G_TYPE_DIR_INFO, GDirInfoIface))

typedef struct _GDirInfo                      GDirInfo; /* Dummy typedef */


/**
 * GDirInfo:
 *
 * Information about a desktop directory.
 */

/**
 * GDirInfoIface:
 * @g_iface: The parent interface.
 * @dup: Copies a #GDirInfo.
 * @equal: Checks two #GDirInfo<!-- -->s for equality.
 * @get_id: Gets a string identifier for a #GDirInfo.
 * @get_name: Gets the name of the directory for a #GDirInfo.
 * @get_description: Gets a short description for the directory described by the #GDirInfo.
 * @get_icon: Gets the #GIcon for the #GDirInfo.
 * @should_show: Returns whether a directory should be shown (e.g. when getting a list of desktop directories).
 * @can_delete: Checks if a #GDirInfo can be deleted. Since 2.20
 * @do_delete: Deletes a #GDirInfo. Since 2.20
 * @get_display_name: Gets the display name for the #GDirInfo. Since 2.24
 *
 * Directory Information interface, for operating system portability.
 */
typedef struct _GDirInfoIface    GDirInfoIface;

struct _GDirInfoIface
{
  GTypeInterface g_iface;

  /* Virtual Table */

  GDirInfo *   (* dup)                          (GDirInfo           *dirinfo);
  gboolean     (* equal)                        (GDirInfo           *dirinfo1,
                                                 GDirInfo           *dirinfo2);
  const char * (* get_id)                       (GDirInfo           *dirinfo);
  const char * (* get_name)                     (GDirInfo           *dirinfo);
  const char * (* get_description)              (GDirInfo           *dirinfo);
  GIcon *      (* get_icon)                     (GDirInfo           *dirinfo);
  gboolean     (* should_show)                  (GDirInfo           *dirinfo);
  gboolean     (* can_delete)                   (GDirInfo           *dirinfo);
  gboolean     (* do_delete)                    (GDirInfo           *dirinfo);
  const char * (* get_display_name)             (GDirInfo           *dirinfo);
};

GLIB_AVAILABLE_IN_ALL
GType       g_dir_info_get_type                     (void) G_GNUC_CONST;

GLIB_AVAILABLE_IN_ALL
GDirInfo *  g_dir_info_create_from_directory_name   (const char           *directory_name,
                                                     GError              **error);

GLIB_AVAILABLE_IN_ALL
GDirInfo *  g_dir_info_dup                          (GDirInfo             *dirinfo);

GLIB_AVAILABLE_IN_ALL
gboolean    g_dir_info_equal                        (GDirInfo             *dirinfo1,
                                                     GDirInfo             *dirinfo2);

GLIB_AVAILABLE_IN_ALL
const char *g_dir_info_get_id                       (GDirInfo             *dirinfo);

GLIB_AVAILABLE_IN_ALL
const char *g_dir_info_get_name                     (GDirInfo             *dirinfo);

GLIB_AVAILABLE_IN_ALL
const char *g_dir_info_get_display_name             (GDirInfo             *dirinfo);

GLIB_AVAILABLE_IN_ALL
const char *g_dir_info_get_description              (GDirInfo             *dirinfo);

GLIB_AVAILABLE_IN_ALL
GIcon *     g_dir_info_get_icon                     (GDirInfo             *dirinfo);

GLIB_AVAILABLE_IN_ALL
gboolean    g_dir_info_should_show                  (GDirInfo             *dirinfo);

GLIB_AVAILABLE_IN_ALL
gboolean    g_dir_info_can_delete                   (GDirInfo   *dirinfo);

GLIB_AVAILABLE_IN_ALL
gboolean    g_dir_info_delete                       (GDirInfo   *dirinfo);

GLIB_AVAILABLE_IN_ALL
GList *   g_dir_info_get_all                     (void);

G_END_DECLS

#endif /* __G_DIR_INFO_H__ */
