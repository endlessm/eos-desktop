// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gettext = imports.gettext;

function _makeLoggingFunc(func) {
    return function() {
        return func([].join.call(arguments, ', '));
    };
}

function coreInit() {
    window.log = _makeLoggingFunc(window.log);

    window._ = Gettext.gettext;
    window.C_ = Gettext.pgettext;
    window.ngettext = Gettext.ngettext;

    const Format = imports.format;
    String.prototype.format = Format.format;
}
