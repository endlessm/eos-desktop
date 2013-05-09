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
INTROSPECTION_SCANNER_ARGS = --warn-all --warn-error --add-include-path=$(srcdir)
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

bin_SCRIPTS += eos-shell-extension-tool eos-shell-extension-prefs \
	       eos-shell-perf-tool
EXTRA_DIST += eos-shell-extension-tool.in eos-shell-extension-prefs.in \
	      eos-shell-perf-tool.in
bin_PROGRAMS = eos-shell-real

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

eos-shell-extension-prefs: eos-shell-extension-prefs.in Makefile
	$(AM_V_GEN) sed $(generated_script_substitutions) $< > $@.tmp && mv $@.tmp $@ && chmod a+x $@

eos-shell-perf-tool: eos-shell-perf-tool.in Makefile
	$(AM_V_GEN) sed $(generated_script_substitutions) $< > $@.tmp && mv $@.tmp $@ && chmod a+x $@

CLEANFILES += eos-shell $(bin_SCRIPTS)

include Makefile-st.am
include Makefile-tray.am
include Makefile-calendar-server.am
include Makefile-hotplug-sniffer.am

eos_shell_cflags =				\
	$(EOS_SHELL_CFLAGS)			\
	-I$(srcdir)/tray			\
	-DVERSION=\"$(VERSION)\"		\
	-DLOCALEDIR=\"$(datadir)/locale\" 	\
	-DDATADIR=\"$(datadir)\"		\
	-DGNOME_SHELL_LIBEXECDIR=\"$(libexecdir)\"	\
	-DGNOME_SHELL_DATADIR=\"$(pkgdatadir)\"	\
	-DGNOME_SHELL_PKGLIBDIR=\"$(pkglibdir)\" \
	-DJSDIR=\"$(pkgdatadir)/js\"		\
	-DMUTTER_TYPELIB_DIR=\"$(MUTTER_TYPELIB_DIR)\"

privlibdir = $(pkglibdir)
privlib_LTLIBRARIES = libeos-shell.la libeos-shell-js.la

shell_built_sources = \
	shell-enum-types.h \
	shell-enum-types.c

BUILT_SOURCES += $(shell_built_sources)

shell_public_headers_h =		\
	shell-app.h			\
	shell-app-system.h		\
	shell-app-usage.h		\
	shell-embedded-window.h		\
	shell-generic-container.h	\
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
	shell-tp-client.h		\
	shell-tray-icon.h		\
	shell-tray-manager.h		\
	shell-util.h			\
	shell-window-tracker.h		\
	shell-wm.h			\
	shell-xfixes-cursor.h

shell_private_sources = \
	gactionmuxer.h			\
	gactionmuxer.c			\
	gactionobservable.h		\
	gactionobservable.c		\
	gactionobserver.h		\
	gactionobserver.c

libeos_shell_la_SOURCES =		\
	$(shell_built_sources)		\
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
	shell-embedded-window.c		\
	shell-generic-container.c	\
	shell-gtk-embed.c		\
	shell-global.c			\
	shell-invert-lightness-effect.c	\
	shell-keyring-prompt.h		\
	shell-keyring-prompt.c		\
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
	shell-tp-client.c			\
	shell-tray-icon.c		\
	shell-tray-manager.c		\
	shell-util.c			\
	shell-window-tracker.c		\
	shell-wm.c			\
	shell-xfixes-cursor.c		\
	$(NULL)

libeos_shell_la_gir_sources = \
	$(filter-out %-private.h $(shell_private_sources), $(shell_public_headers_h) $(libeos_shell_la_SOURCES))

eos_shell_real_SOURCES =		\
	main.c
eos_shell_real_CPPFLAGS = $(eos_shell_cflags)
eos_shell_real_LDADD = libeos-shell.la libeos-shell-js.la $(libeos_shell_la_LIBADD)
eos_shell_real_DEPENDENCIES = libeos-shell.la

########################################

libeos_shell_js_la_SOURCES =		\
	shell-js.h			\
	shell-js.c			\
	$(NULL)

libeos_shell_js_la_LIBADD =		\
	$(EOS_SHELL_JS_LIBS)		\
	$(NULL)

libeos_shell_js_la_LDFLAGS =		\
	-avoid-version

libeos_shell_js_la_CPPFLAGS =		\
	$(EOS_SHELL_JS_CFLAGS)

########################################

shell_recorder_sources =        \
	shell-recorder.c	\
	shell-recorder.h

# Custom element is an internal detail

if BUILD_RECORDER
libeos_shell_la_SOURCES += $(shell_recorder_sources)

shell_recorder_private_sources =  \
	shell-recorder-src.c	\
	shell-recorder-src.h	\
	$(NULL)

shell_private_sources += $(shell_recorder_private_sources)

noinst_PROGRAMS += test-recorder

test_recorder_CPPFLAGS = $(TEST_SHELL_RECORDER_CFLAGS)
test_recorder_LDADD = $(TEST_SHELL_RECORDER_LIBS)

test_recorder_SOURCES =     \
	$(shell_recorder_sources) $(shell_recorder_private_sources) \
	test-recorder.c
endif BUILD_RECORDER

########################################

libexec_PROGRAMS += eos-shell-perf-helper

eos_shell_perf_helper_SOURCES = shell-perf-helper.c
eos_shell_perf_helper_CPPFLAGS = $(SHELL_PERF_HELPER_CFLAGS)
eos_shell_perf_helper_LDADD = $(SHELL_PERF_HELPER_LIBS)

########################################

noinst_PROGRAMS += run-js-test

run_js_test_CPPFLAGS = $(eos_shell_cflags)
run_js_test_LDADD = libeos-shell.la $(libeos_shell_la_LIBADD)
run_js_test_LDFLAGS = -export-dynamic

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
	-lm			\
	$(EOS_SHELL_LIBS)	\
	$(BLUETOOTH_LIBS)	\
	libst-1.0.la       	\
	libtray.la		\
	gvc/libgvc.la		\
	$(NULL)

libeos_shell_la_CPPFLAGS = $(eos_shell_cflags)

Shell-0.1.gir: libeos-shell.la St-1.0.gir
Shell_0_1_gir_INCLUDES = Clutter-1.0 ClutterX11-1.0 Meta-3.0 TelepathyGLib-0.12 Soup-2.4 GMenu-3.0 NetworkManager-1.0 NMClient-1.0
Shell_0_1_gir_CFLAGS = $(libeos_shell_la_CPPFLAGS) -I $(srcdir)
Shell_0_1_gir_LIBS = libeos-shell.la
Shell_0_1_gir_FILES = $(libeos_shell_la_gir_sources)
Shell_0_1_gir_SCANNERFLAGS = --include-uninstalled=$(builddir)/St-1.0.gir \
	--add-include-path=$(MUTTER_GIR_DIR) $(if $(BLUETOOTH_DIR),-L $(BLUETOOTH_DIR),)
INTROSPECTION_GIRS += Shell-0.1.gir
CLEANFILES += Shell-0.1.gir

ShellJS-0.1.gir: libeos-shell-js.la
ShellJS_0_1_gir_CFLAGS = $(libeos_shell_la_CPPFLAGS) -I $(srcdir)
ShellJS_0_1_gir_LIBS = libeos-shell-js.la
ShellJS_0_1_gir_FILES = $(libeos_shell_js_la_SOURCES)
INTROSPECTION_GIRS += ShellJS-0.1.gir
CLEANFILES += ShellJS-0.1.gir

St-1.0.gir: libst-1.0.la
St_1_0_gir_INCLUDES = Clutter-1.0 Gtk-3.0
St_1_0_gir_CFLAGS = $(st_cflags) -DST_COMPILATION
St_1_0_gir_LIBS = libst-1.0.la
St_1_0_gir_FILES = $(filter-out %-private.h $(st_non_gir_sources), $(addprefix $(srcdir)/,$(st_source_h))) \
	$(addprefix $(srcdir)/,$(st_source_c))
INTROSPECTION_GIRS += St-1.0.gir
CLEANFILES += St-1.0.gir
