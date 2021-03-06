AC_PREREQ(2.63)
AC_INIT([eos-shell],[3.8.0],[https://github.com/endlessm/eos-shell])

AC_CONFIG_HEADERS([config.h])
AC_CONFIG_SRCDIR([src/shell-global.c])
AC_CONFIG_MACRO_DIR([m4])
AC_CONFIG_AUX_DIR([config])

AC_SUBST([PACKAGE_NAME], ["$PACKAGE_NAME"])
AC_SUBST([PACKAGE_VERSION], ["$PACKAGE_VERSION"])

AM_INIT_AUTOMAKE([1.11.2 no-dist-gzip dist-xz tar-ustar foreign parallel-tests])
AM_MAINTAINER_MODE([enable])

m4_ifdef([AM_SILENT_RULES],[AM_SILENT_RULES([yes])])

# Checks for programs.
AC_PROG_CC
AC_PROG_CXX
AC_PROG_AWK

# Initialize libtool
LT_PREREQ([2.2.6])
LT_INIT([disable-static])

# i18n
IT_PROG_INTLTOOL([0.40])

GETTEXT_PACKAGE=eos-desktop
AC_SUBST(GETTEXT_PACKAGE)
AC_DEFINE_UNQUOTED(GETTEXT_PACKAGE, "$GETTEXT_PACKAGE",
                   [The prefix for our gettext translation domains.])

PKG_PROG_PKG_CONFIG([0.22])

AC_PATH_PROG([XSLTPROC], [xsltproc])

GLIB_GSETTINGS

AC_REQUIRE_AUX_FILE([tap-driver.sh])
AC_PATH_PROG([JASMINE], [jasmine])

# Get a value to substitute into gnome-shell.in
AM_PATH_PYTHON([2.5])
AC_SUBST(PYTHON)

# We need at least this, since gst_plugin_register_static() was added
# in 0.10.16, but nothing older than 0.10.21 has been tested.
GSTREAMER_MIN_VERSION=0.11.92

recorder_modules=
build_recorder=false
AC_MSG_CHECKING([for GStreamer (needed for recording functionality)])
if $PKG_CONFIG --exists gstreamer-1.0 '>=' $GSTREAMER_MIN_VERSION ; then
   AC_MSG_RESULT(yes)
   build_recorder=true
   recorder_modules="gstreamer-1.0 gstreamer-base-1.0 x11 gtk+-3.0"
   PKG_CHECK_MODULES(TEST_SHELL_RECORDER, $recorder_modules mutter-clutter-1.0 xfixes)
else
   AC_MSG_RESULT(no)
fi

AM_CONDITIONAL(BUILD_RECORDER, $build_recorder)

AC_ARG_ENABLE([systemd],
              AS_HELP_STRING([--enable-systemd], [Use systemd]),
              [enable_systemd=$enableval],
              [enable_systemd=auto])
AS_IF([test x$enable_systemd != xno], [
  AC_MSG_CHECKING([for libsystemd-journal])
  PKG_CHECK_EXISTS([libsystemd-journal],
                   [have_systemd=yes
                    AC_DEFINE([HAVE_SYSTEMD], [1], [Define if we have systemd])],
                   [have_systemd=no])
  AC_MSG_RESULT($have_systemd)
])

AC_MSG_RESULT($enable_systemd)

CLUTTER_MIN_VERSION=1.21.5
GOBJECT_INTROSPECTION_MIN_VERSION=0.10.1
GJS_MIN_VERSION=1.36.1
MUTTER_MIN_VERSION=3.22.1
GTK_MIN_VERSION=3.7.9
GIO_MIN_VERSION=2.35.0
LIBECAL_MIN_VERSION=3.5.3
LIBEDATASERVER_MIN_VERSION=3.5.3
POLKIT_MIN_VERSION=0.100
STARTUP_NOTIFICATION_MIN_VERSION=0.11
GCR_MIN_VERSION=3.3.90
GNOME_DESKTOP_REQUIRED_VERSION=3.7.90
NETWORKMANAGER_MIN_VERSION=0.9.6
PULSE_MIN_VERS=2.0

# Collect more than 20 libraries for a prize!
PKG_CHECK_MODULES(EOS_SHELL, gio-unix-2.0 >= $GIO_MIN_VERSION
			       libxml-2.0
                               gtk+-3.0 >= $GTK_MIN_VERSION
                               atk-bridge-2.0
                               gjs-1.0 >= $GJS_MIN_VERSION
                               $recorder_modules
                               gdk-x11-3.0 libsoup-2.4
                               mutter-clutter-1.0 >= $CLUTTER_MIN_VERSION
                               mutter-cogl-pango-1.0
                               libstartup-notification-1.0 >= $STARTUP_NOTIFICATION_MIN_VERSION
                               gobject-introspection-1.0 >= $GOBJECT_INTROSPECTION_MIN_VERSION
			       libcanberra libcanberra-gtk3
                               polkit-agent-1 >= $POLKIT_MIN_VERSION xfixes
                               libnm-glib libnm-util >= $NETWORKMANAGER_MIN_VERSION
                               libnm-gtk >= $NETWORKMANAGER_MIN_VERSION
                               libsecret-unstable gcr-3 >= $GCR_MIN_VERSION
                               eosmetrics-0)

PKG_CHECK_MODULES(EOS_SHELL_JS, gio-2.0 gjs-1.0 >= $GJS_MIN_VERSION)
PKG_CHECK_MODULES(MUTTER, libmutter >= $MUTTER_MIN_VERSION)

PKG_CHECK_MODULES(ST, mutter-clutter-1.0 gtk+-3.0 libcroco-0.6 >= 0.6.8 x11)
PKG_CHECK_MODULES(EOS_SHELL_FX, mutter-clutter-1.0 >= 1.16 glib-2.0 >= 2.38 libwindowfx_wobbly)
PKG_CHECK_MODULES(SHELL_PERF_HELPER, gtk+-3.0 gio-2.0)
PKG_CHECK_MODULES(SHELL_HOTPLUG_SNIFFER, gio-2.0 gdk-pixbuf-2.0)
PKG_CHECK_MODULES(TRAY, gtk+-3.0)
PKG_CHECK_MODULES(GVC, libpulse >= $PULSE_MIN_VERS libpulse-mainloop-glib gobject-2.0)
PKG_CHECK_MODULES(DESKTOP_SCHEMAS, gsettings-desktop-schemas >= 3.7.4)
PKG_CHECK_MODULES(CARIBOU, caribou-1.0 >= 0.4.8)

PKG_CHECK_MODULES(BLUETOOTH, gnome-bluetooth-1.0 >= 3.9.0,
        [AC_DEFINE([HAVE_BLUETOOTH],[1],[Define if you have libgnome-bluetooth-applet])
	 AC_SUBST([HAVE_BLUETOOTH],[1])],
	[AC_DEFINE([HAVE_BLUETOOTH],[0])
	 AC_SUBST([HAVE_BLUETOOTH],[0])])

PKG_CHECK_MODULES(CALENDAR_SERVER, libecal-1.2 >= $LIBECAL_MIN_VERSION libedataserver-1.2 >= $LIBEDATASERVER_MIN_VERSION gio-2.0)
AC_SUBST(CALENDAR_SERVER_CFLAGS)
AC_SUBST(CALENDAR_SERVER_LIBS)

AC_ARG_ENABLE([install-keybindings],
              AS_HELP_STRING([--disable-install-keybindings], [Install keybindings globally]),
              [install_gnome_keybindings=no],
              [install_gnome_keybindings=yes])
AC_MSG_CHECKING([whether to install keybindings globally])
AC_MSG_RESULT($install_gnome_keybindings)

GNOME_KEYBINDINGS_KEYSDIR=`$PKG_CONFIG --variable keysdir gnome-keybindings`
AC_SUBST([GNOME_KEYBINDINGS_KEYSDIR])
AM_CONDITIONAL([INSTALL_GNOME_KEYBINDINGS],
               [test "x$install_gnome_keybindings" = "xyes"])

GOBJECT_INTROSPECTION_CHECK([$GOBJECT_INTROSPECTION_MIN_VERSION])

MUTTER_GIR_DIR=`$PKG_CONFIG --variable=girdir libmutter`
MUTTER_TYPELIB_DIR=`$PKG_CONFIG --variable=typelibdir libmutter`
AC_SUBST(MUTTER_GIR_DIR)
AC_SUBST(MUTTER_TYPELIB_DIR)

GJS_CONSOLE=`$PKG_CONFIG --variable=gjs_console gjs-1.0`
AC_SUBST(GJS_CONSOLE)

GLIB_COMPILE_RESOURCES=`$PKG_CONFIG --variable glib_compile_resources gio-2.0`
AC_SUBST(GLIB_COMPILE_RESOURCES)

AC_CHECK_FUNCS(fdwalk)
AC_CHECK_FUNCS(mallinfo)
AC_CHECK_HEADERS([sys/resource.h])

# _NL_TIME_FIRST_WEEKDAY is an enum and not a define
AC_MSG_CHECKING([for _NL_TIME_FIRST_WEEKDAY])
AC_COMPILE_IFELSE([AC_LANG_PROGRAM([[#include <langinfo.h>]],
                                   [[nl_langinfo(_NL_TIME_FIRST_WEEKDAY);]])],
               [langinfo_ok=yes], [langinfo_ok=no])
AC_MSG_RESULT($langinfo_ok)
if test "$langinfo_ok" = "yes"; then
  AC_DEFINE([HAVE__NL_TIME_FIRST_WEEKDAY], [1],
            [Define if _NL_TIME_FIRST_WEEKDAY is available])
fi

# Sets GLIB_GENMARSHAL and GLIB_MKENUMS
AM_PATH_GLIB_2_0()

GTK_DOC_CHECK([1.15], [--flavour no-tmpl])

AC_ARG_ENABLE(man,
              [AS_HELP_STRING([--enable-man],
                              [generate man pages [default=yes]])],,
              enable_man=yes)
if test "$enable_man" != no; then
  AC_PATH_PROG([XSLTPROC], [xsltproc])
  if test -z "$XSLTPROC"; then
    AC_MSG_ERROR([xsltproc is required for --enable-man])
  fi
fi
AM_CONDITIONAL(ENABLE_MAN, test "$enable_man" != no)

GNOME_COMPILE_WARNINGS([error])

AC_ARG_ENABLE(jhbuild-wrapper-script,
  AS_HELP_STRING([--enable-jhbuild-wrapper-script],[Make "gnome-shell" script work for jhbuild]),,enable_jhbuild_wrapper_script=no)
AM_CONDITIONAL(USE_JHBUILD_WRAPPER_SCRIPT, test "x$enable_jhbuild_wrapper_script" = xyes)

# JASMINE_JUNIT_REPORTS_DIR: Where to put test reports
AC_MSG_CHECKING([where to put test reports])
AC_ARG_VAR([JASMINE_JUNIT_REPORTS_DIR], [Where to put test reports])
AS_IF([test -n "$JASMINE_JUNIT_REPORTS_DIR"],
  [JASMINE_REPORT_ARGUMENT="--junit $JASMINE_JUNIT_REPORTS_DIR/\$\${log/%.log/.js.xml}"
  AC_MSG_RESULT([in $JASMINE_JUNIT_REPORTS_DIR])],
  [JASMINE_REPORT_ARGUMENT=
  AC_MSG_RESULT([nowhere])])
AC_SUBST([JASMINE_REPORT_ARGUMENT])

# Enable coverage reporting
EOS_COVERAGE_REPORT([c js])

AC_ARG_VAR([GDBUS_CODEGEN],[the gdbus-codegen programme])
AC_PATH_PROG([GDBUS_CODEGEN],[gdbus-codegen],[])
if test -z "$GDBUS_CODEGEN"; then
  AC_MSG_ERROR([gdbus-codegen not found])
fi

AC_CONFIG_FILES([
  Makefile
  data/Makefile
  docs/Makefile
  docs/reference/Makefile
  docs/reference/shell/Makefile
  docs/reference/shell/shell-docs.sgml
  docs/reference/st/Makefile
  docs/reference/st/st-docs.sgml
  js/Makefile
  src/calendar-server/evolution-calendar.desktop.in
  src/Makefile
  src/gvc/Makefile
  tests/Makefile
  po/Makefile.in
  man/Makefile
])
AC_OUTPUT
