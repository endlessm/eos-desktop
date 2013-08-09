/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
/* EOS Shell flip effect for taskbar icons
 *
 * Copyright © 2013 Endless Mobile, Inc.
 *
 * Based on https://git.gnome.org/browse/clutter/tree/clutter/clutter-page-turn-effect.h
 * Copyright (C) 2010  Intel Corporation.
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

#ifndef __SHELL_PAGE_FLIP_EFFECT_H__
#define __SHELL_PAGE_FLIP_EFFECT_H__

#include <glib-object.h>
#include <clutter/clutter.h>

G_BEGIN_DECLS

#define SHELL_TYPE_PAGE_FLIP_EFFECT        (shell_page_flip_effect_get_type ())
#define SHELL_PAGE_FLIP_EFFECT(obj)        (G_TYPE_CHECK_INSTANCE_CAST ((obj), SHELL_TYPE_PAGE_FLIP_EFFECT, ShellPageFlipEffect))
#define SHELL_IS_PAGE_FLIP_EFFECT(obj)     (G_TYPE_CHECK_INSTANCE_TYPE ((obj), SHELL_TYPE_PAGE_FLIP_EFFECT))

typedef struct _ShellPageFlipEffect        ShellPageFlipEffect;
typedef struct _ShellPageFlipEffectClass   ShellPageFlipEffectClass;

GType shell_page_flip_effect_get_type (void) G_GNUC_CONST;

ClutterEffect *shell_page_flip_effect_new (void);

void    shell_page_flip_effect_set_angle  (ShellPageFlipEffect *effect,
                                           gdouble              angle);
gdouble shell_page_flip_effect_get_angle  (ShellPageFlipEffect *effect);

G_END_DECLS

#endif /* __SHELL_PAGE_FLIP_EFFECT_H__ */
