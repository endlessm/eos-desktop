// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;

function makeCloseButton() {
    let closeButton = new St.Button({ style_class: 'notification-close'});

    // This is a bit tricky. St.Bin has its own x-align/y-align properties
    // that compete with Clutter's properties. This should be fixed for
    // Clutter 2.0. Since St.Bin doesn't define its own setters, the
    // setters are a workaround to get Clutter's version.
    closeButton.set_x_align(Clutter.ActorAlign.END);
    closeButton.set_y_align(Clutter.ActorAlign.START);

    // XXX Clutter 2.0 workaround: ClutterBinLayout needs expand
    // to respect the alignments.
    closeButton.set_x_expand(true);
    closeButton.set_y_expand(true);

    closeButton.connect('style-changed', function() {
        let themeNode = closeButton.get_theme_node();
        closeButton.translation_x = themeNode.get_length('-shell-close-overlap-x');
        closeButton.translation_y = themeNode.get_length('-shell-close-overlap-y');
    });

    return closeButton;
}
