desktopdir=$(datadir)/applications
desktop_DATA = eos-shell.desktop eos-shell-extension-prefs.desktop eos-app-feedback.desktop eos-launch.desktop

sessionsdir=$(datadir)/xsessions
sessions_DATA = eos-session.desktop

# We substitute in bindir so it works as an autostart
# file when built in a non-system prefix
%.desktop.in:%.desktop.in.in
	$(AM_V_GEN) sed -e "s|@bindir[@]|$(bindir)|" \
	    -e "s|@pkgdatadir[@]|$(pkgdatadir)|" \
	    -e "s|@VERSION[@]|$(VERSION)|" \
	    $< > $@ || rm $@

@INTLTOOL_DESKTOP_RULE@

greeterdesktopdir = $(datadir)/gdm/greeter/applications
greeterdesktop_DATA = gdm-eos-shell.desktop

gnomesessiondir = $(datadir)/gnome-session/sessions
gnomesession_DATA = eos-shell.session gdm-eos-shell.session

%.session.in: %.session.in.in
	$(AM_V_GEN) sed -e "s|@LIBDIR[@]|$(libdir)|" \
	    $< > $@

%.session: %.session.in
	$(INTLTOOL_MERGE) $(wildcard $(top_srcdir)/po/*.po) ; LC_ALL=C $(INTLTOOL_MERGE) -d -u -c $(top_builddir)/po/.intltool-merge-cache $(top_srcdir)/po $< $@

@INTLTOOL_DESKTOP_RULE@
@INTLTOOL_XML_NOMERGE_RULE@

introspectiondir = $(datadir)/dbus-1/interfaces
introspection_DATA =				\
	org.gnome.Shell.Screencast.xml		\
	org.gnome.Shell.Screenshot.xml		\
	org.gnome.ShellSearchProvider.xml	\
	org.gnome.ShellSearchProvider2.xml

resource_files = $(shell $(GLIB_COMPILE_RESOURCES) --sourcedir=$(srcdir)/theme --generate-dependencies $(srcdir)/gnome-shell-theme.gresource.xml)
gnome-shell-theme.gresource: gnome-shell-theme.gresource.xml $(resource_files)
	$(AM_V_GEN) $(GLIB_COMPILE_RESOURCES) --target=$@ --sourcedir=$(srcdir)/theme $<
resourcedir = $(pkgdatadir)
resource_DATA = gnome-shell-theme.gresource

keys_in_files =					\
	50-gnome-shell-system.xml.in		\
	$(NULL)
keys_DATA = $(NULL)

if INSTALL_GNOME_KEYBINDINGS
keysdir = $(GNOME_KEYBINDINGS_KEYSDIR)
keys_DATA += $(keys_in_files:.xml.in=.xml)
endif

gsettings_SCHEMAS = org.gnome.shell.gschema.xml

@INTLTOOL_XML_NOMERGE_RULE@

%.gschema.xml.in: %.gschema.xml.in.in Makefile
	$(AM_V_GEN) sed -e 's|@GETTEXT_PACKAGE[@]|$(GETTEXT_PACKAGE)|g' \
	$< > $@ || rm $@

@GSETTINGS_RULES@

# We need to compile schemas at make time
# to run from source tree
gschemas.compiled: $(gsettings_SCHEMAS:.xml=.valid)
	$(AM_V_GEN) $(GLIB_COMPILE_SCHEMAS) --targetdir=. .

all-local: gschemas.compiled

bin_SCRIPTS = resfix

convertdir = $(datadir)/GConf/gsettings
convert_DATA = gnome-shell-overrides.convert

install-data-hook: 99-gdm-eos-shell-settings
	if test '!' -d $(DESTDIR)$(sysconfdir)/dconf/db/gdm.d; then \
		$(mkinstalldirs) $(DESTDIR)$(sysconfdir)/dconf/db/gdm.d; \
		chmod 0755 $(DESTDIR)$(sysconfdir)/dconf/db/gdm.d; \
		chown root:root $(DESTDIR)$(sysconfdir)/dconf/db/gdm.d || : ; \
	fi

	$(INSTALL_DATA) $(srcdir)/99-gdm-eos-shell-settings $(DESTDIR)$(sysconfdir)/dconf/db/gdm.d
	test -z "$(DESTDIR)" && dconf update || :

uninstall-hook:
	rm -f $(DESTDIR)$(sysconfdir)/dconf/db/gdm.d/99-gdm-eos-shell-settings


EXTRA_DIST =					\
	99-gdm-eos-shell-settings		\
	gdm-eos-shell.desktop.in.in		\
	gdm-eos-shell.session			\
	eos-shell.desktop.in.in			\
	eos-session.desktop.in.in		\
	eos-shell.session.in.in			\
	eos-shell-extension-prefs.desktop.in.in	\
	eos-app-feedback.desktop.in.in		\
	resfix					\
	$(introspection_DATA)			\
	$(menu_DATA)				\
	$(convert_DATA)				\
	$(keys_in_files)			\
	org.gnome.shell.gschema.xml.in.in	\
	eos-launch.desktop.in.in		\
	gnome-shell-theme.gresource.xml		\
	$(resource_files)

CLEANFILES =					\
	gdm-eos-shell.desktop.in		\
	eos-shell.desktop.in			\
	eos-session.desktop.in			\
	eos-shell-extension-prefs.in		\
	eos-shell.session			\
	eos-shell.session.in			\
	eos-app-feedback.desktop.in		\
	$(desktop_DATA)				\
	$(greeterdesktop_DATA)			\
	$(sessions_DATA)			\
	$(keys_DATA)				\
	$(gsettings_SCHEMAS)			\
	gschemas.compiled			\
	org.gnome.shell.gschema.valid		\
	org.gnome.shell.gschema.xml.in		\
	eos-launch.desktop.in			\
	gnome-shell-theme.gresource
