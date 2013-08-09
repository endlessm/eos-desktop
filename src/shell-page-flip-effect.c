/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
/* EOS Shell flip effect for taskbar icons
 *
 * Copyright © 2013 Endless Mobile, Inc.
 *
 * Based on https://git.gnome.org/browse/clutter/tree/clutter/clutter-page-turn-effect.c
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

/**
 * SECTION:shell-page-flip-effect
 * @Title: ShellPageFlipEffect
 * @Short_Description: A horizontal flip effect
 *
 * A simple horizontal flip effect
 */

#include <math.h>

#include <cogl/cogl.h>

#include "shell-page-flip-effect.h"

#define MAX_ANGLE 360.0

#define SHELL_PAGE_FLIP_EFFECT_CLASS(k)       (G_TYPE_CHECK_CLASS_CAST ((k), SHELL_TYPE_PAGE_FLIP_EFFECT, ShellPageFilpEffectClass))
#define SHELL_IS_PAGE_FLIP_EFFECT_CLASS(k)    (G_TYPE_CHECK_CLASS_TYPE ((k), SHELL_TYPE_PAGE_FLIP_EFFECT))
#define SHELL_PAGE_FLIP_EFFECT_GET_CLASS(o)   (G_TYPE_INSTANCE_GET_CLASS ((o), SHELL_TYPE_PAGE_FLIP_EFFECT, ShellPageFlipEffectClass))

struct _ShellPageFlipEffect
{
  ClutterDeformEffect parent_instance;

  gdouble angle;

  gboolean middlePointValid;
  gfloat xMiddlePoint;
  gfloat yMiddlePoint;
};

struct _ShellPageFlipEffectClass
{
  ClutterDeformEffectClass parent_class;
};

enum
{
  PROP_0,

  PROP_ANGLE,

  PROP_LAST
};

static GParamSpec *obj_props[PROP_LAST];

G_DEFINE_TYPE (ShellPageFlipEffect,
               shell_page_flip_effect,
               CLUTTER_TYPE_DEFORM_EFFECT);

static void
shell_page_flip_effect_deform_vertex (ClutterDeformEffect *effect,
                                      gfloat               width,
                                      gfloat               height,
                                      CoglTextureVertex   *vertex)
{
  ShellPageFlipEffect *self = SHELL_PAGE_FLIP_EFFECT (effect);
  if (!self->middlePointValid) {
    self->xMiddlePoint = width / 2;
    self->yMiddlePoint = height / 2;
  }

  gfloat scaledAngle = self->angle / MAX_ANGLE;

  gfloat xDistanceFromAnchor = vertex->x;
  if (scaledAngle > 0.5) {
      xDistanceFromAnchor = width - xDistanceFromAnchor;
  }

  // Scale vertically
  gfloat maxYScaleFactor = xDistanceFromAnchor / (width * 3);
  gfloat yScale = 1 - sin(scaledAngle * M_PI) * maxYScaleFactor;
  gfloat yOffsetFromMiddle = vertex->y - self->yMiddlePoint;
  vertex->y = self->yMiddlePoint + yOffsetFromMiddle * yScale;

  // Scale horizontally proportional to the cosine
  gfloat xScale = fabs(cos(scaledAngle * M_PI));
  gfloat xOffsetFromMiddle = vertex->x - self->xMiddlePoint;
  gfloat xScaledOffset = xOffsetFromMiddle * xScale;

  // Give the icon a bit of "thickness" even when pointing away
  if (fabs(xScaledOffset) < 1) {
    // Offsetting by 2 is a bit of a hack to get the icon centered
    xScaledOffset  = xScaledOffset > 0 ? 2 : 0;
  }
  vertex->x = self->xMiddlePoint + xScaledOffset;
}

static void
shell_page_flip_effect_set_property (GObject      *gobject,
                                     guint         prop_id,
                                     const GValue *value,
                                     GParamSpec   *pspec)
{
  ShellPageFlipEffect *effect = SHELL_PAGE_FLIP_EFFECT (gobject);

  switch (prop_id)
    {
      case PROP_ANGLE:
        shell_page_flip_effect_set_angle (effect, g_value_get_double (value));
        break;

      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (gobject, prop_id, pspec);
        break;
    }
}

static void
shell_page_flip_effect_get_property (GObject    *gobject,
                                     guint       prop_id,
                                     GValue     *value,
                                     GParamSpec *pspec)
{
  ShellPageFlipEffect *effect = SHELL_PAGE_FLIP_EFFECT (gobject);

  switch (prop_id)
    {
      case PROP_ANGLE:
        g_value_set_double (value, effect->angle);
        break;

      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (gobject, prop_id, pspec);
        break;
    }  
}

static void
shell_page_flip_effect_class_init (ShellPageFlipEffectClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  ClutterDeformEffectClass *deform_class = CLUTTER_DEFORM_EFFECT_CLASS (klass);
  GParamSpec *pspec;

  gobject_class->set_property = shell_page_flip_effect_set_property;
  gobject_class->get_property = shell_page_flip_effect_get_property;

  /**
   * ShellPageFlipEffect:angle:
   *
   * The angle of the flip rotation, in degrees, between 0.0 and 360.0
   *
   */
  pspec = g_param_spec_double ("angle",
                               "Angle",
                               "The angle of the flip rotation, in degrees",
                               0.0, MAX_ANGLE,
                               0.0,
                               G_PARAM_READABLE | G_PARAM_WRITABLE);
  obj_props[PROP_ANGLE] = pspec;
  g_object_class_install_property (gobject_class, PROP_ANGLE, pspec);


  deform_class->deform_vertex = shell_page_flip_effect_deform_vertex;
}

static void
shell_page_flip_effect_init (ShellPageFlipEffect *self)
{
  self->angle = 0.0;
  self->middlePointValid = FALSE;
}

/**
 * shell_page_flip_effect_new:
 *
 * Creates a new #ShellPageFlipEffect instance
 *
 * Return value: the newly created #ShellPageFlipEffect
 */
ClutterEffect *
shell_page_flip_effect_new (void)
{
  return g_object_new (SHELL_TYPE_PAGE_FLIP_EFFECT, NULL);
}

/**
 * shell_page_flip_effect_set_angle:
 * @effect: #ShellPageFlipEffect
 * @angle: the angle of the flip rotation, in degrees
 *
 * Sets the angle of the flip rotation, in degrees
 */
void
shell_page_flip_effect_set_angle (ShellPageFlipEffect *effect,
                                  gdouble              angle)
{
  g_return_if_fail (SHELL_IS_PAGE_FLIP_EFFECT (effect));
  g_return_if_fail (angle >= 0.0 && angle <= MAX_ANGLE);

  effect->angle = angle;
  clutter_deform_effect_invalidate (CLUTTER_DEFORM_EFFECT (effect));

  g_object_notify_by_pspec (G_OBJECT (effect), obj_props[PROP_ANGLE]);
}

/**
 * shell_page_flip_effect_get_angle:
 * @effect: a #ShellPageFlipEffect:
 *
 * Retrieves the value set using shell_page_flip_effect_get_angle()
 *
 * Return value: the angle of the flip rotation
 */
gdouble
shell_page_flip_effect_get_angle (ShellPageFlipEffect *effect)
{
  g_return_val_if_fail (SHELL_IS_PAGE_FLIP_EFFECT (effect), 0.0);

  return effect->angle;
}
