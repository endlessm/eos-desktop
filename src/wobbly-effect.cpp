/*
 * wobbly-effect.cpp
 *
 * Copyright (c) Endless Mobile Inc.
 */

#include <array>
#include <boost/noncopyable.hpp>

#include <glib-object.h>
#include <gio/gio.h>
#include <clutter/clutter.h>

#include <windowfx/wobbly/wobbly.h>

#include "wobbly-effect.h"

namespace bg = boost::geometry;

typedef struct _EndlessShellFXWobblyPrivate
{
    float          slowdown_factor;

    ClutterActor   *actor;
    wobbly::Model  *model;
    wobbly::Anchor *anchor;
    gint64         last_msecs;
    guint          timeout_id;
    guint          width_changed_signal;
    guint          height_changed_signal;

    /* We'll be touching this seldomly, so put
     * it down here for now */
    wobbly::Model::Settings model_settings;

    /* Single bit at the end of the struct */
    bool          ungrab_pending : 1;
} EndlessShellFXWobblyPrivate;

enum
{
    PROP_0,

    PROP_SPRING_K,
    PROP_FRICTION,
    PROP_SLOWDOWN_FACTOR,
    PROP_OBJECT_MOVEMENT_RANGE,

    PROP_LAST
};

static GParamSpec *object_properties[PROP_LAST];

G_DEFINE_TYPE_WITH_PRIVATE (EndlessShellFXWobbly,
                            endless_shell_fx_wobbly,
                            CLUTTER_TYPE_DEFORM_EFFECT)

static gboolean
endless_shell_fx_wobbly_lie_about_paint_volume (ClutterEffect      *effect,
                                                ClutterPaintVolume *volume)
{
    return CLUTTER_EFFECT_CLASS (endless_shell_fx_wobbly_parent_class)->get_paint_volume (effect,
                                                                                          volume);
}

static gboolean
endless_shell_fx_wobbly_get_paint_volume (ClutterEffect      *effect,
                                          ClutterPaintVolume *volume)
{
    EndlessShellFXWobbly *wobbly_effect =
        ENDLESS_SHELL_FX_WOBBLY (effect);
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (wobbly_effect));


    /* We assume that the parent's get_paint_volume method always returns
     * TRUE here. */
    CLUTTER_EFFECT_CLASS (endless_shell_fx_wobbly_parent_class)->get_paint_volume (effect,
                                                                                   volume);

    if (priv->model)
    {
        std::array <wobbly::Point, 4> const extremes = priv->model->Extremes ();

        float x1 = std::min (bg::get <0> (extremes[0]), bg::get <0> (extremes[2]));
        float y1 = std::min (bg::get <1> (extremes[0]), bg::get <1> (extremes[1]));
        float x2 = std::max (bg::get <0> (extremes[1]), bg::get <0> (extremes[3]));
        float y2 = std::max (bg::get <1> (extremes[2]), bg::get <1> (extremes[3]));

        ClutterActorBox const extremesBox =
        {
            static_cast <float> (std::floor (x1)),
            static_cast <float> (std::floor (y1)),
            static_cast <float> (std::ceil (x2)),
            static_cast <float> (std::ceil (y2))
        };

        clutter_paint_volume_union_box (volume, &extremesBox);
    }

    return TRUE;
}

namespace
{
    /* Utility class to force the usage of the actor-only paint volume as opposed
     * to our expanded paint volume from the effect running */
    class RAIIActorPaintBox :
        boost::noncopyable
    {
        public:

            RAIIActorPaintBox (ClutterEffectClass *effect_class) :
                effect_class (effect_class)
            {
                effect_class->get_paint_volume = endless_shell_fx_wobbly_lie_about_paint_volume;
            }

            ~RAIIActorPaintBox ()
            {
                effect_class->get_paint_volume = endless_shell_fx_wobbly_get_paint_volume;
            }

        private:

            ClutterEffectClass *effect_class;
    };
}

/* ClutterOffscreenEffect calls clutter_actor_get_paint_box in order to
 * determine the size of the buffer to redirect into. However, we can't
 * just provide the paint box that we would have used in order for the
 * wobbly effect because then it will end up creating a slightly larger
 * framebuffer object to put our texture into. So we have to hook
 * pre_paint here, replace our function pointer for a bit while we chain
 * chain up so that we don't get a funky looking paint box and then replace
 * it with our function to get the *actual* paint volume. */
static gboolean
endless_shell_fx_wobbly_pre_paint (ClutterEffect *effect)
{
    EndlessShellFXWobbly *wobbly_effect =
        ENDLESS_SHELL_FX_WOBBLY (effect);
    EndlessShellFXWobblyClass *klass =
        ENDLESS_SHELL_FX_WOBBLY_GET_CLASS (wobbly_effect);
    ClutterEffectClass *effect_class = CLUTTER_EFFECT_CLASS (klass);

    RAIIActorPaintBox forced_client_paint_box (effect_class);

    return CLUTTER_EFFECT_CLASS (endless_shell_fx_wobbly_parent_class)->pre_paint (effect);
}

static void
endless_shell_fx_wobbly_deform_vertex (ClutterDeformEffect *effect,
                                       gfloat              ,
                                       gfloat              ,
                                       CoglTextureVertex   *vertex)
{
    EndlessShellFXWobbly *wobbly_effect =
        ENDLESS_SHELL_FX_WOBBLY (effect);
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (wobbly_effect));

    wobbly::Point deformed =
        priv->model->DeformTexcoords (wobbly::Point (vertex->ty,
                                                     vertex->tx));
    vertex->x = bg::get <0> (deformed);
    vertex->y = bg::get <1> (deformed);
}

static void
remove_anchor_if_pending (EndlessShellFXWobblyPrivate *priv)
{
    if (priv->ungrab_pending)
    {
        delete priv->anchor;
        priv->anchor = nullptr;
        priv->ungrab_pending = false;
    }
}

/* It turns out that clutter doesn't contain any mechanism whatsoever
 * to do timeline-less animations. We're just using a timeout here
 * to keep performing animations on the actor */
static gboolean
endless_shell_fx_wobbly_new_frame (gpointer user_data)
{
    EndlessShellFXWobbly *wobbly_effect = ENDLESS_SHELL_FX_WOBBLY (user_data);
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (wobbly_effect));
    gint64 msecs = g_get_monotonic_time ();

    static const unsigned int ms_to_us = 1000;

    g_assert (priv->model);

    /* Wraparound, priv->last_msecs -= G_MAXINT64.
     * We make priv->last_msecs negative so that subtracting it
     * from msecs results in the correct delta */
    if (G_UNLIKELY (priv->last_msecs > msecs))
        priv->last_msecs -= G_MAXINT64;

    gint64 msecs_delta = (msecs - priv->last_msecs ) / ms_to_us;
    priv->last_msecs = msecs;

    /* If there was no time movement, then we can't really step or remove
     * models in a way that makes sense, so don't do it */
    if (msecs_delta)
    {
        if (priv->model->Step (msecs_delta / priv->slowdown_factor))
        {
            clutter_actor_meta_set_enabled (CLUTTER_ACTOR_META (wobbly_effect),
                                            TRUE);
            clutter_deform_effect_invalidate (CLUTTER_DEFORM_EFFECT (wobbly_effect));
        }
        else
        {
            remove_anchor_if_pending (priv);

            /* Also disable the effect */
            clutter_actor_meta_set_enabled (CLUTTER_ACTOR_META (wobbly_effect),
                                            FALSE);

            /* Finally, return false so that we don't keep animating */
            priv->timeout_id = 0;
            return FALSE;
        }
    }

    /* We always want to return true even if there was no time delta */
    return TRUE;
}

static void
endless_shell_fx_wobbly_ensure_timeline (EndlessShellFXWobbly *wobbly_effect)
{
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (wobbly_effect));

    if (!priv->timeout_id)
    {
        static const unsigned int frame_length_ms = 16; // 60 / 1000;

        priv->last_msecs = g_get_monotonic_time ();
        priv->timeout_id = g_timeout_add (frame_length_ms, endless_shell_fx_wobbly_new_frame, wobbly_effect);
    }
}

void
endless_shell_fx_wobbly_grab (EndlessShellFXWobbly *effect,
                              double              x,
                              double              y)
{
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (effect));

    g_assert (!priv->anchor || priv->ungrab_pending);

    /* Either ungrab here or at the end of the animation */
    remove_anchor_if_pending (priv);

    if (priv->model)
    {
        /* Make sure to move the model to the actor's current position first
         * as it may have changed in the meantime */
        priv->model->MoveModelTo (wobbly::Point (0, 0));

        endless_shell_fx_wobbly_ensure_timeline (effect);

        float actor_x, actor_y;
        clutter_actor_get_position (priv->actor, &actor_x, &actor_y);

        priv->anchor = new wobbly::Anchor (priv->model->GrabAnchor (wobbly::Point (x - actor_x,
                                                                                   y - actor_y)));
    }
}

void
endless_shell_fx_wobbly_ungrab (EndlessShellFXWobbly *effect)
{
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (effect));

    g_assert (priv->anchor && !priv->ungrab_pending);

    /* Don't immediately ungrab. We can be a little bit more
     * clever here and make the ungrab pending on the completion
     * of the animation */
    if (priv->timeout_id)
        priv->ungrab_pending = true;
    else
    {
        delete priv->anchor;
        priv->anchor = nullptr;
    }
}

void
endless_shell_fx_wobbly_move_by (EndlessShellFXWobbly *effect,
                                 double              dx,
                                 double              dy)
{
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (effect));

    if (priv->anchor)
    {
        wobbly::Vector delta (dx, dy);

        endless_shell_fx_wobbly_ensure_timeline (effect);
        priv->anchor->MoveBy (delta);

        wobbly::Vector reverse_delta (delta);
        bg::multiply_value (reverse_delta, -1);

        /* Now move the entire model back - this ensures that
         * we stay in sync with the actor's relative position */
        priv->model->MoveModelBy (reverse_delta);
    }
}

static void
endless_shell_fx_get_actor_only_paint_box_size (EndlessShellFXWobbly *effect,
                                                ClutterActor         *actor,
                                                gfloat               *width,
                                                gfloat               *height)
{
    EndlessShellFXWobblyClass *klass =
        ENDLESS_SHELL_FX_WOBBLY_GET_CLASS (effect);
    ClutterEffectClass *effect_class = CLUTTER_EFFECT_CLASS (klass);

    /* We want the size of the paint box and not the actor
     * size, because that's going to be the size of the
     * texture. However, we only want the size of the
     * paint box when we're just considering the
     * actor alone */
    RAIIActorPaintBox forced_client_paint_box (effect_class);
    ClutterActorBox   rect;

    /* If clutter_actor_get_paint_box fails
     * we should fall back to the actor size at this point */
    if (clutter_actor_get_paint_box (actor, &rect))
        clutter_actor_box_get_size (&rect, width, height);
    else
        clutter_actor_get_size (actor, width, height);
}

static void
endless_shell_fx_wobbly_size_changed (GObject    *object,
                                      GParamSpec *,
                                      gpointer   user_data)
{
    ClutterActor        *actor = CLUTTER_ACTOR (object);
    EndlessShellFXWobbly *effect = ENDLESS_SHELL_FX_WOBBLY (user_data);
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (effect));

    /* We don't ensure a timeline here because we only want to redistribute
     * non-anchor points if we're already grabbed, which the wobbly effect will
     * do internally anyways */
    if (priv->model) {
        float actor_width, actor_height;
        endless_shell_fx_get_actor_only_paint_box_size (effect,
                                                        actor,
                                                        &actor_width,
                                                        &actor_height);

        /* If we have any pending anchors, we should release them now -
         * the model move and resize code explicitly does not move
         * anchors around (because that'd put them out of sync with
         * the cursor) */
        remove_anchor_if_pending (priv);

        priv->model->ResizeModel (actor_width, actor_height);
        priv->model->MoveModelTo (wobbly::Point (0, 0));

    }
}

static void
endless_shell_fx_wobbly_set_actor (ClutterActorMeta *actor_meta,
                                   ClutterActor     *actor)
{
    CLUTTER_ACTOR_META_CLASS (endless_shell_fx_wobbly_parent_class)->set_actor (actor_meta,
                                                                                 actor);

    EndlessShellFXWobbly *wobbly_effect = ENDLESS_SHELL_FX_WOBBLY (actor_meta);
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (wobbly_effect));

    /* If we're grabbed, we have to immediately get rid of the grab
     * as the grab depends on objects inside the model */
    if (priv->anchor)
    {
        delete priv->anchor;
        priv->anchor = nullptr;
        priv->ungrab_pending = false;
    }

    if (priv->model)
    {
        delete priv->model;
        priv->model = nullptr;
    }

    if (priv->timeout_id)
    {
        g_source_remove (priv->timeout_id);
        priv->timeout_id = 0;
    }

    if (priv->actor)
    {
        g_signal_handler_disconnect (priv->actor, priv->width_changed_signal);
        priv->width_changed_signal = 0;

        g_signal_handler_disconnect (priv->actor, priv->height_changed_signal);
        priv->height_changed_signal = 0;
    }

    priv->actor = actor;

    if (priv->actor)
    {
        float actor_width, actor_height;
        endless_shell_fx_get_actor_only_paint_box_size (wobbly_effect,
                                                        priv->actor,
                                                        &actor_width,
                                                        &actor_height);

        priv->model = new wobbly::Model (wobbly::Point (0, 0),
                                         actor_width,
                                         actor_height,
                                         priv->model_settings);

        priv->width_changed_signal =
            g_signal_connect_object (priv->actor,
                                     "notify::width",
                                     G_CALLBACK (endless_shell_fx_wobbly_size_changed),
                                     wobbly_effect,
                                     static_cast <GConnectFlags> (G_CONNECT_AFTER));
        priv->height_changed_signal =
            g_signal_connect_object (priv->actor,
                                     "notify::height",
                                     G_CALLBACK (endless_shell_fx_wobbly_size_changed),
                                     wobbly_effect,
                                     static_cast <GConnectFlags> (G_CONNECT_AFTER));

    }

    /* Whatever the actor, ensure that the effect is disabled at this point */
    clutter_actor_meta_set_enabled (actor_meta,
                                    FALSE);
}

static void
endless_shell_fx_wobbly_set_property (GObject      *object,
                                      guint        prop_id,
                                      const GValue *value,
                                      GParamSpec   *pspec)
{
    EndlessShellFXWobbly *wobbly_effect =
        reinterpret_cast <EndlessShellFXWobbly *> (object);
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (wobbly_effect));

    switch (prop_id)
    {
        case PROP_SPRING_K:
            priv->model_settings.springConstant = g_value_get_double (value);
            break;
        case PROP_FRICTION:
            priv->model_settings.friction = g_value_get_double (value);
            break;
        case PROP_SLOWDOWN_FACTOR:
            priv->slowdown_factor = g_value_get_double (value);
            break;
        case PROP_OBJECT_MOVEMENT_RANGE:
            priv->model_settings.maximumRange = g_value_get_double (value);
            break;
        default:
            G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
            break;
    }
}

static void
endless_shell_fx_wobbly_finalize (GObject *object)
{
    EndlessShellFXWobbly *wobbly_effect =
        reinterpret_cast <EndlessShellFXWobbly *> (object);
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (wobbly_effect));

    if (priv->model)
        delete priv->model;

    if (priv->timeout_id)
    {
        g_source_remove (priv->timeout_id);
        priv->timeout_id = 0;
    }

    G_OBJECT_CLASS (endless_shell_fx_wobbly_parent_class)->finalize (object);
}

static void
endless_shell_fx_wobbly_init (EndlessShellFXWobbly *effect)
{
    EndlessShellFXWobblyPrivate *priv =
        reinterpret_cast <EndlessShellFXWobblyPrivate *> (endless_shell_fx_wobbly_get_instance_private (effect));

    priv->actor = nullptr;
    priv->model = nullptr;
    priv->timeout_id = 0;

    priv->width_changed_signal = 0;
    priv->height_changed_signal = 0;

    priv->model_settings = wobbly::Model::DefaultSettings;

    priv->ungrab_pending = false;
}

static void
endless_shell_fx_wobbly_class_init (EndlessShellFXWobblyClass *klass)
{
    GObjectClass *object_class = G_OBJECT_CLASS (klass);
    ClutterActorMetaClass *meta_class =
        CLUTTER_ACTOR_META_CLASS (klass);
    ClutterEffectClass *effect_class =
        CLUTTER_EFFECT_CLASS (klass);
    ClutterDeformEffectClass *deform_class =
        CLUTTER_DEFORM_EFFECT_CLASS (klass);

    object_class->set_property = endless_shell_fx_wobbly_set_property;
    object_class->finalize = endless_shell_fx_wobbly_finalize;
    meta_class->set_actor = endless_shell_fx_wobbly_set_actor;
    effect_class->pre_paint = endless_shell_fx_wobbly_pre_paint;
    effect_class->get_paint_volume = endless_shell_fx_wobbly_get_paint_volume;
    deform_class->deform_vertex = endless_shell_fx_wobbly_deform_vertex;

    object_properties[PROP_SPRING_K] =
        g_param_spec_double ("spring-k",
                             "Spring Constant",
                             "How springy the model is",
                             2.0f, 10.0f, 8.0f,
                             G_PARAM_WRITABLE);

    object_properties[PROP_FRICTION] =
        g_param_spec_double ("friction",
                             "Friction Constant",
                             "How much friction force should be applied to moving objects",
                             2.0f, 10.0f, 3.0f,
                             G_PARAM_WRITABLE);

    object_properties[PROP_SLOWDOWN_FACTOR] =
        g_param_spec_double ("slowdown-factor",
                             "Slowdown Factor",
                             "How much to slow the model's timesteps down",
                             1.0f, 5.0f, 1.0f,
                             G_PARAM_WRITABLE);

    object_properties[PROP_OBJECT_MOVEMENT_RANGE] =
        g_param_spec_double ("object-movement-range",
                             "Object Movement Range",
                             "How much objects are allowed to move around",
                             10.0f, 500.0f, 100.0f,
                             G_PARAM_WRITABLE);

    g_object_class_install_properties (object_class, PROP_LAST, object_properties);
}

ClutterEffect *
endless_shell_fx_wobbly_new ()
{
    return reinterpret_cast <ClutterEffect *> (g_object_new (ENDLESS_SHELL_FX_TYPE_WOBBLY,
                                                             "x-tiles", 32,
                                                             "y-tiles", 32,
                                                             nullptr));
}
