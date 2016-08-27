/*
 * wobbly-effect.h
 *
 * Copyright (c) Endless Mobile Inc.
 */

#ifndef ENDLESS_SHELL_FX_WOBBLY_H
#define ENDLESS_SHELL_FX_WOBBLY_H

#include <glib-object.h>
#include <clutter/clutter.h>

G_BEGIN_DECLS

#define ENDLESS_SHELL_FX_TYPE_WOBBLY endless_shell_fx_wobbly_get_type ()

#define ENDLESS_SHELL_FX_WOBBLY(obj) \
    (G_TYPE_CHECK_INSTANCE_CAST((obj), \
     ENDLESS_SHELL_FX_TYPE_WOBBLY, EndlessShellFXWobbly))

#define ENDLESS_SHELL_FX_WOBBLY_CLASS(obj) \
    (G_TYPE_CHECK_CLASS_CAST((obj) \
     ENDLESS_SHELL_FX_TYPE_WOBBLY, EndlessShellFXWobblyClass))

#define ENDLESS_SHELL_FX_WOBBLY_GET_CLASS(obj) \
    (G_TYPE_INSTANCE_GET_CLASS((obj), \
     ENDLESS_SHELL_FX_TYPE_WOBBLY, EndlessShellFXWobblyClass))

typedef struct _EndlessShellFXWobbly EndlessShellFXWobbly;
typedef struct _EndlessShellFXWobblyClass EndlessShellFXWobblyClass;

struct _EndlessShellFXWobbly
{
    ClutterDeformEffect parent;
};

struct _EndlessShellFXWobblyClass
{
    ClutterDeformEffectClass parent_class;
};

GType endless_shell_fx_wobbly_get_type (void);

/**
 * endless_shell_fx_wobbly_grab:
 * @x: The x-coordinate on the mesh to grab, specified relative to the
 * upper-left corner of the mesh
 * @y: The y-coordinate on the mesh to grab, specified relative to the
 * upper-left corner of the mesh.
 *
 * Grabs the anchor specified by @x and @y on the mesh. While
 * the mesh is in this state, this point will move immediately,
 * causing spring forces to be applied to other points on the mesh
 *
 * It is a precondition violation to call this function when the mesh is
 * already grabbed.
 *
 */
void endless_shell_fx_wobbly_grab (EndlessShellFXWobbly *effect,
                                   double               x,
                                   double               y);

/**
 * endless_shell_fx_wobbly_ungrab:
 * Removes the current grab. When the actor is moved, the mesh will
 * move uniformly.
 *
 * It is a precondition violation to call this function when the mesh is
 * not grabbed.
 */
void endless_shell_fx_wobbly_ungrab (EndlessShellFXWobbly *effect);

/**
 * endless_shell_fx_wobbly_move_by:
 * @dx: A delta-x coordinate to move the mesh by
 * @dy: A delta-y coordinate to move the mesh by
 *
 * Moves the mesh by @dx and @dy
 *
 * If the mesh is grabbed, then spring forces will be applied causing
 * some points on the mesh to move more slowly than others. The nature
 * of the moment will depend on the window's maximization state.
 *
 */
void endless_shell_fx_wobbly_move_by (EndlessShellFXWobbly *effect,
                                      double               dx,
                                      double               dy);

/**
 * endless_shell_fx_wobbly_new:
 *
 * Creates a new #ClutterEffect which makes the window "wobble"
 * on a spring mesh for the actor
 *
 * Returns: (transfer full): A new #ClutterEffect
 */
ClutterEffect * endless_shell_fx_wobbly_new ();

G_END_DECLS

#endif
