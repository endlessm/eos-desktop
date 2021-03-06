
NULL = 
BUILT_SOURCES =
CLEANFILES =
EXTRA_DIST =
bin_SCRIPTS =
libexec_PROGRAMS =
noinst_LTLIBRARIES =
noinst_PROGRAMS =
service_in_files =

SUBDIRS = gvc

-include $(INTROSPECTION_MAKEFILE)
INTROSPECTION_GIRS =
INTROSPECTION_SCANNER_ARGS = --warn-all --warn-error --add-include-path=$(srcdir) --add-include-path=$(MUTTER_GIR_DIR) -L$(MUTTER_TYPELIB_DIR)
INTROSPECTION_COMPILER_ARGS = --includedir=$(srcdir) --includedir=$(MUTTER_TYPELIB_DIR)

typelibdir = $(pkglibdir)
typelib_DATA = $(INTROSPECTION_GIRS:.gir=.typelib)

servicedir = $(datadir)/dbus-1/services
service_DATA = $(service_in_files:.service.in=.service)

%.service: %.service.in Makefile
	$(AM_V_GEN)									\
		[ -d $(@D) ] || $(mkdir_p) $(@D) ;					\
		sed -e "s|\@libexecdir\@|$(libexecdir)|" $< > $@.tmp && mv $@.tmp $@
CLEANFILES += $(service_DATA)

CLEANFILES += $(gir_DATA) $(typelib_DATA)

bin_SCRIPTS += eos-shell-extension-tool eos-shell-perf-tool
EXTRA_DIST += eos-shell-extension-tool.in eos-shell-perf-tool.in
bin_PROGRAMS = eos-shell-real eos-shell-extension-prefs

if USE_JHBUILD_WRAPPER_SCRIPT
eos_shell = eos-shell-jhbuild
bin_SCRIPTS += eos-shell-jhbuild
else
eos_shell = eos-shell-real
endif
EXTRA_DIST += eos-shell-jhbuild.in

noinst_DATA = eos-shell
eos-shell: $(eos_shell) Makefile
	$(AM_V_GEN) cp $< $@.tmp && mv $@.tmp $@
install-exec-hook:
	mv $(DESTDIR)$(bindir)/$(eos_shell) $(DESTDIR)$(bindir)/eos-shell
uninstall-hook:
	rm -f $(DESTDIR)$(bindir)/eos-shell

generated_script_substitutions = \
	    -e "s|@bindir[@]|$(bindir)|g" \
	    -e "s|@datadir[@]|$(datadir)|g" \
	    -e "s|@libexecdir[@]|$(libexecdir)|g" \
	    -e "s|@libdir[@]|$(libdir)|g" \
	    -e "s|@pkglibdir[@]|$(pkglibdir)|g" \
	    -e "s|@pkgdatadir[@]|$(pkgdatadir)|g" \
	    -e "s|@PYTHON[@]|$(PYTHON)|g" \
	    -e "s|@VERSION[@]|$(VERSION)|g" \
	    -e "s|@sysconfdir[@]|$(sysconfdir)|g" \
	    -e "s|@GJS_CONSOLE[@]|$(GJS_CONSOLE)|g"

eos-shell-jhbuild: eos-shell-jhbuild.in eos-shell-real Makefile
	$(AM_V_GEN) sed $(generated_script_substitutions) $< > $@.tmp && mv $@.tmp $@ && chmod a+x $@
	@# Regenerate libtool wrapper so Alt+F2 restart will work
	@$(LIBTOOL) --mode=execute test -f eos-shell-real

eos-shell-extension-tool: eos-shell-extension-tool.in Makefile
	$(AM_V_GEN) sed $(generated_script_substitutions) $< > $@.tmp && mv $@.tmp $@ && chmod a+x $@

eos-shell-perf-tool: eos-shell-perf-tool.in Makefile
	$(AM_V_GEN) sed $(generated_script_substitutions) $< > $@.tmp && mv $@.tmp $@ && chmod a+x $@

CLEANFILES += eos-shell $(bin_SCRIPTS)

# Nothing here, no files to cover, but we need to set this so that
# EOS_COVERAGE_RULES doesn't complain
EOS_JS_COVERAGE_FILES =

@EOS_COVERAGE_RULES@

org-gtk-application.c org-gtk-application.h: org.gtk.Application.xml Makefile
	$(AM_V_GEN) $(GDBUS_CODEGEN) \
			--generate-c-code org-gtk-application \
			--c-namespace Shell \
			$<

EXTRA_DIST += org.gtk.Application.xml

include Makefile-st.am
include Makefile-tray.am
include Makefile-calendar-server.am
include Makefile-hotplug-sniffer.am

eos_shell_cflags =				\
	$(EOS_SHELL_CFLAGS)			\
	$(MUTTER_CFLAGS)			\
	@EOS_C_COVERAGE_CFLAGS@			\
	-I$(srcdir)/tray			\
	-DVERSION=\"$(VERSION)\"		\
	-DLOCALEDIR=\"$(datadir)/locale\" 	\
	-DDATADIR=\"$(datadir)\"		\
	-DGNOME_SHELL_LIBEXECDIR=\"$(libexecdir)\"	\
	-DGNOME_SHELL_DATADIR=\"$(pkgdatadir)\"	\
	-DGNOME_SHELL_PKGLIBDIR=\"$(pkglibdir)\" \
	-DMUTTER_TYPELIB_DIR=\"$(MUTTER_TYPELIB_DIR)\"

privlibdir = $(pkglibdir)
privlib_LTLIBRARIES = libeos-shell.la libeos-shell-fx.la

shell_built_sources = \
	org-gtk-application.h \
	org-gtk-application.c \
	shell-enum-types.h \
	shell-enum-types.c

BUILT_SOURCES += $(shell_built_sources)

shell_public_headers_h =		\
	shell-app.h			\
	shell-app-system.h		\
	shell-app-usage.h		\
	shell-desktop-dir-info.h	\
	shell-dir-info.h		\
	shell-embedded-window.h		\
	shell-generic-container.h	\
	shell-grid-desaturate-effect.h	\
	shell-gtk-embed.h		\
	shell-global.h			\
	shell-invert-lightness-effect.h	\
	shell-keybinding-modes.h	\
	shell-mount-operation.h		\
	shell-network-agent.h		\
	shell-perf-log.h		\
	shell-screenshot.h		\
	shell-slicer.h			\
	shell-stack.h			\
	shell-tray-icon.h		\
	shell-tray-manager.h		\
	shell-util.h			\
	shell-window-tracker.h		\
	shell-wm.h

shell_private_sources = 		\
	gtkactionmuxer.h		\
	gtkactionmuxer.c		\
	gtkactionobservable.h		\
	gtkactionobservable.c		\
	gtkactionobserver.h		\
	gtkactionobserver.c		\
	gtkmenutrackeritem.c		\
	gtkmenutrackeritem.h		\
	gtkmenutracker.c		\
	gtkmenutracker.h		\
	$(NULL)

libeos_shell_sources =			\
	$(shell_public_headers_h)	\
	$(shell_private_sources)	\
	shell-app-private.h		\
	shell-app-system-private.h	\
	shell-embedded-window-private.h	\
	shell-global-private.h		\
	shell-window-tracker-private.h	\
	shell-wm-private.h		\
	gnome-shell-plugin.c		\
	shell-app.c			\
	shell-app-system.c		\
	shell-app-usage.c		\
	shell-desktop-dir-info.c	\
	shell-dir-info.c		\
	shell-embedded-window.c		\
	shell-generic-container.c	\
	shell-gtk-embed.c		\
	shell-global.c			\
	shell-grid-desaturate-effect.c  \
	shell-invert-lightness-effect.c	\
	shell-keyring-prompt.h		\
	shell-keyring-prompt.c		\
	shell-menu-tracker.c		\
	shell-menu-tracker.h		\
	shell-mount-operation.c		\
	shell-network-agent.c		\
	shell-perf-log.c		\
	shell-polkit-authentication-agent.h	\
	shell-polkit-authentication-agent.c	\
	shell-screenshot.c		\
	shell-secure-text-buffer.c	\
	shell-secure-text-buffer.h	\
	shell-slicer.c			\
	shell-stack.c			\
	shell-tray-icon.c		\
	shell-tray-manager.c		\
	shell-util.c			\
	shell-window-tracker.c		\
	shell-wm.c			\
	$(NULL)

libeos_shell_built_sources =		\
	$(shell_built_sources)		\
	$(top_builddir)/js/js-resources.c		\
	$(top_builddir)/js/js-resources.h		\
	$(NULL)

libeos_shell_la_SOURCES = $(libeos_shell_sources)
nodist_libeos_shell_la_SOURCES = $(libeos_shell_built_sources)

shell_no_gir_sources = \
	org-gtk-application.h \
	org-gtk-application.c

libeos_shell_la_gir_sources = \
	$(filter-out %-private.h $(shell_private_sources) $(shell_no_gir_sources), $(shell_public_headers_h) $(libeos_shell_sources) $(libeos_shell_built_sources))

eos_shell_real_SOURCES =		\
	main.c
eos_shell_real_CPPFLAGS = $(eos_shell_cflags)
eos_shell_real_LDADD = libeos-shell.la libeos-shell-fx.la $(libeos_shell_la_LIBADD)
eos_shell_real_LDFLAGS = @EOS_C_COVERAGE_LDFLAGS@ -rpath $(MUTTER_TYPELIB_DIR)

eos_shell_extension_prefs_SOURCES = 	\
	gnome-shell-extension-prefs.c 	\
	$(NULL)
nodist_eos_shell_extension_prefs_SOURCES = \
	$(top_builddir)/js/js-resources.c		\
	$(top_builddir)/js/js-resources.h		\
	$(NULL)
eos_shell_extension_prefs_CPPFLAGS = $(eos_shell_cflags)
eos_shell_extension_prefs_LDADD = $(EOS_SHELL_LIBS) -lm
eos_shell_extension_prefs_LDFLAGS = @EOS_C_COVERAGE_LDFLAGS@ -rpath $(MUTTER_TYPELIB_DIR)

########################################

# Set up the libeos-shell-fx target
libeos_shell_fx_la_SOURCES =	\
	wobbly-effect.cpp	\
	wobbly-effect.h		\
	$(NULL)

libeos_shell_fx_la_LIBADD =	\
	$(EOS_SHELL_FX_LIBS)	\
	$(NULL)

libeos_shell_fx_la_LDFLAGS =	\
	-avoid-version		\
	$(NULL)

libeos_shell_fx_la_CPPFLAGS =	\
	$(EOS_SHELL_FX_CFLAGS)	\
	-std=c++11		\
	$(NULL)

########################################

shell_recorder_sources =        \
	shell-recorder.c	\
	shell-recorder.h

# Custom element is an internal detail

if BUILD_RECORDER
libeos_shell_sources += $(shell_recorder_sources)

shell_recorder_private_sources =  \
	shell-recorder-src.c	\
	shell-recorder-src.h	\
	$(NULL)

shell_private_sources += $(shell_recorder_private_sources)

endif BUILD_RECORDER

########################################

libexec_PROGRAMS += eos-shell-perf-helper

eos_shell_perf_helper_SOURCES = shell-perf-helper.c
eos_shell_perf_helper_CPPFLAGS =	\
	$(SHELL_PERF_HELPER_CFLAGS)	\
	@EOS_C_COVERAGE_CFLAGS@		\
	$(NULL)

eos_shell_perf_helper_LDADD =		\
	$(SHELL_PERF_HELPER_LIBS)	\
	$(NULL)

eos_shell_perf_helper_LDFLAGS = @EOS_C_COVERAGE_LDFLAGS@

########################################

noinst_PROGRAMS += run-js-test

run_js_test_CPPFLAGS = $(MUTTER_CFLAGS) $(eos_shell_cflags)
run_js_test_LDADD = libeos-shell.la $(libeos_shell_la_LIBADD) $(MUTTER_LIBS)
run_js_test_LDFLAGS = -export-dynamic -rpath $(MUTTER_TYPELIB_DIR)

run_js_test_SOURCES =			\
	run-js-test.c

########################################

shell-enum-types.h: stamp-shell-enum-types.h Makefile
	@true
stamp-shell-enum-types.h: $(srcdir)/shell-enum-types.h.in $(shell_public_headers_h)
	$(AM_V_GEN) ( \
	  $(GLIB_MKENUMS) \
	    --template $< \
	  $(addprefix $(srcdir)/,$(shell_public_headers_h)) ) > $(@F).tmp && \
	(cmp -s $(@F).tmp shell-enum-types.h || mv $(@F).tmp shell-enum-types.h) && \
	rm -f $(@F).tmp && \
	echo timestamp > $(@F)
EXTRA_DIST += shell-enum-types.h.in
CLEANFILES += stamp-shell-enum-types.h

shell-enum-types.c: $(srcdir)/shell-enum-types.c.in stamp-shell-enum-types.h
	$(AM_V_GEN) ( \
	  $(GLIB_MKENUMS) \
	    --template $< \
	  $(addprefix $(srcdir)/,$(shell_public_headers_h)) ) > $(@F).tmp && \
	mv $(@F).tmp $(@F) && \
	rm -f $(@F).tmp
EXTRA_DIST += shell-enum-types.c.in

libeos_shell_la_LDFLAGS = -avoid-version

libeos_shell_la_LIBADD =		\
	-lm				\
	@EOS_C_COVERAGE_LDFLAGS@	\
	$(EOS_SHELL_LIBS)		\
	$(MUTTER_LIBS)			\
	$(BLUETOOTH_LIBS)		\
	libst-1.0.la       		\
	libtray.la			\
	gvc/libgvc.la			\
	$(NULL)

libeos_shell_la_CPPFLAGS = $(eos_shell_cflags) $(MUTTER_CFLAGS)

ShellMenu-0.1.gir: libeos-shell.la
ShellMenu_0_1_gir_INCLUDES = Gio-2.0
ShellMenu_0_1_gir_CFLAGS = $(libeos_shell_la_CPPFLAGS) -I $(srcdir)
ShellMenu_0_1_gir_LIBS = libeos-shell.la
Shell_0_1_gir_SCANNERFLAGS =	\
	$(if $(BLUETOOTH_DIR),-L $(BLUETOOTH_DIR),)
ShellMenu_0_1_gir_FILES = \
	gtkactionmuxer.h		\
	gtkactionmuxer.c		\
	gtkactionobservable.h		\
	gtkactionobservable.c		\
	gtkactionobserver.h		\
	gtkactionobserver.c		\
	gtkmenutrackeritem.c		\
	gtkmenutrackeritem.h		\
	$(NULL)
ShellMenu_0_1_gir_SCANNERFLAGS = --namespace=ShellMenu --identifier-prefix=Gtk
INTROSPECTION_GIRS += ShellMenu-0.1.gir
CLEANFILES += ShellMenu-0.1.gir

Shell-0.1.gir: libeos-shell.la St-1.0.gir ShellMenu-0.1.gir
Shell_0_1_gir_INCLUDES = Clutter-1.0 ClutterX11-1.0 Meta-3.0 Soup-2.4 NetworkManager-1.0 NMClient-1.0
Shell_0_1_gir_CFLAGS = $(libeos_shell_la_CPPFLAGS) -I $(srcdir)
Shell_0_1_gir_LIBS = libeos-shell.la
Shell_0_1_gir_FILES = $(libeos_shell_la_gir_sources)
Shell_0_1_gir_SCANNERFLAGS =	\
	--include-uninstalled=$(builddir)/St-1.0.gir \
	--include-uninstalled=$(builddir)/ShellMenu-0.1.gir \
	--add-include-path=$(MUTTER_GIR_DIR)
INTROSPECTION_GIRS += Shell-0.1.gir
CLEANFILES += Shell-0.1.gir

St-1.0.gir: libst-1.0.la
St_1_0_gir_INCLUDES = Clutter-1.0 Gtk-3.0
St_1_0_gir_CFLAGS = $(st_cflags) -DST_COMPILATION
St_1_0_gir_LIBS = libst-1.0.la
St_1_0_gir_FILES = $(filter-out %-private.h $(st_non_gir_sources), $(addprefix $(srcdir)/,$(st_source_h))) \
	$(addprefix $(srcdir)/,$(st_source_c))
INTROSPECTION_GIRS += St-1.0.gir
CLEANFILES += St-1.0.gir

EndlessShellFX-1.0.gir: libeos-shell-fx.la
EndlessShellFX_1_0_gir_INCLUDES = Clutter-1.0
EndlessShellFX_1_0_gir_CFLAGS = $(EOS_SHELL_FX_CFLAGS) -I $(srcdir)
EndlessShellFX_1_0_gir_LIBS = libeos-shell-fx.la
EndlessShellFX_1_0_gir_FILES = $(libeos_shell_fx_la_SOURCES)
EndlessShellFX_1_0_gir_SCANNERFLAGS = --warn-all
INTROSPECTION_GIRS += EndlessShellFX-1.0.gir
CLEANFILES += EndlessShellFX-1.0.gir
