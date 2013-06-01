/* EOS Shell directory information
 *
 * Copyright © 2013 Endless Mobile, Inc.
 *
 * Based on https://git.gnome.org/browse/glib/tree/gio/gappinfo.c
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

#include "config.h"
#include "shell-dir-info.h"

#include <gio/gio.h>


/**
 * SECTION:gdirinfo
 * @short_description: Desktop directory information
 * @include: gio/gio.h
 * 
 * #GDirInfo is used for describing directories on the desktop.
 *
 **/

typedef GDirInfoIface GDirInfoInterface;
G_DEFINE_INTERFACE (GDirInfo, g_dir_info, G_TYPE_OBJECT)

static void
g_dir_info_default_init (GDirInfoInterface *iface)
{
}


/**
 * g_dir_info_dup:
 * @dirinfo: a #GDirInfo.
 * 
 * Creates a duplicate of a #GDirInfo.
 *
 * Returns: (transfer full): a duplicate of @dirinfo.
 **/
GDirInfo *
g_dir_info_dup (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;

  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), NULL);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  return (* iface->dup) (dirinfo);
}

/**
 * g_dir_info_equal:
 * @dirinfo1: the first #GDirInfo.
 * @dirinfo2: the second #GDirInfo.
 *
 * Checks if two #GDirInfo<!-- -->s are equal.
 *
 * Returns: %TRUE if @dirinfo1 is equal to @dirinfo2. %FALSE otherwise.
 **/
gboolean
g_dir_info_equal (GDirInfo *dirinfo1,
		  GDirInfo *dirinfo2)
{
  GDirInfoIface *iface;

  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo1), FALSE);
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo2), FALSE);

  if (G_TYPE_FROM_INSTANCE (dirinfo1) != G_TYPE_FROM_INSTANCE (dirinfo2))
    return FALSE;
  
  iface = G_DIR_INFO_GET_IFACE (dirinfo1);

  return (* iface->equal) (dirinfo1, dirinfo2);
}

/**
 * g_dir_info_get_id:
 * @dirinfo: a #GDirInfo.
 * 
 * Gets the ID of a directory. An id is a string that
 * identifies the directory. The exact format of the id is
 * platform dependent. For instance, on Unix this is the
 * desktop file id from the xdg menu specification.
 *
 * Note that the returned ID may be %NULL, depending on how
 * the @dirinfo has been constructed.
 *
 * Returns: a string containing the directory's ID.
 **/
const char *
g_dir_info_get_id (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;
  
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), NULL);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  return (* iface->get_id) (dirinfo);
}

/**
 * g_dir_info_get_name:
 * @dirinfo: a #GDirInfo.
 * 
 * Gets the name of the directory. 
 *
 * Returns: the name of the directory for @dirinfo.
 **/
const char *
g_dir_info_get_name (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;
  
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), NULL);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  return (* iface->get_name) (dirinfo);
}

/**
 * g_dir_info_get_display_name:
 * @dirinfo: a #GDirInfo.
 *
 * Gets the display name of the directory. The display name is often more
 * descriptive to the user than the name itself.
 *
 * Returns: the display name of the directory for @dirinfo, or the name if
 * no display name is available.
 *
 * Since: 2.24
 **/
const char *
g_dir_info_get_display_name (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;

  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), NULL);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  if (iface->get_display_name == NULL)
    return (* iface->get_name) (dirinfo);

  return (* iface->get_display_name) (dirinfo);
}

/**
 * g_dir_info_get_description:
 * @dirinfo: a #GDirInfo.
 * 
 * Gets a human-readable description of a directory.
 *
 * Returns: a string containing a description of the 
 * directory @dirinfo, or %NULL if none. 
 **/
const char *
g_dir_info_get_description (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;
  
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), NULL);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  return (* iface->get_description) (dirinfo);
}


/**
 * g_dir_info_get_icon:
 * @dirinfo: a #GDirInfo.
 * 
 * Gets the icon for the directory.
 *
 * Returns: (transfer none): the default #GIcon for @dirinfo or %NULL
 * if there is no default icon.
 **/
GIcon *
g_dir_info_get_icon (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;
  
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), NULL);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  return (* iface->get_icon) (dirinfo);
}


/**
 * g_dir_info_should_show:
 * @dirinfo: a #GDirInfo.
 *
 * Checks if the directory info should be shown in menus that 
 * list available directories.
 * 
 * Returns: %TRUE if the @dirinfo should be shown, %FALSE otherwise.
 **/
gboolean
g_dir_info_should_show (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;
  
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), FALSE);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  return (* iface->should_show) (dirinfo);
}


/**
 * g_dir_info_can_delete:
 * @dirinfo: a #GDirInfo
 *
 * Obtains the information whether the #GDirInfo can be deleted.
 * See g_dir_info_delete().
 *
 * Returns: %TRUE if @dirinfo can be deleted
 *
 * Since: 2.20
 */
gboolean
g_dir_info_can_delete (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;
  
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), FALSE);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  if (iface->can_delete)
    return (* iface->can_delete) (dirinfo);
 
  return FALSE; 
}


/**
 * g_dir_info_delete:
 * @dirinfo: a #GDirInfo
 *
 * Tries to delete a #GDirInfo.
 *
 * On some platforms, there may be a difference between user-defined
 * #GDirInfo<!-- -->s which can be deleted, and system-wide ones which
 * cannot. See g_dir_info_can_delete().
 *
 * Virtual: do_delete
 * Returns: %TRUE if @dirinfo has been deleted
 *
 * Since: 2.20
 */
gboolean
g_dir_info_delete (GDirInfo *dirinfo)
{
  GDirInfoIface *iface;
  
  g_return_val_if_fail (G_IS_DIR_INFO (dirinfo), FALSE);

  iface = G_DIR_INFO_GET_IFACE (dirinfo);

  if (iface->do_delete)
    return (* iface->do_delete) (dirinfo);
 
  return FALSE; 
}
