# Point to our macro directory and pick up user flags from the environment
ACLOCAL_AMFLAGS  = -I m4 ${ACLOCAL_FLAGS}

SUBDIRS = data js src browser-plugin tests po docs

if ENABLE_MAN
SUBDIRS += man
endif

EXTRA_DIST =		\
	.project	\
	.settings	\
	autogen.sh	\
	jasmine		\
	jasmine.json	\
	tools/check-for-missing.py

# These are files checked into Git that we don't want to distribute
DIST_EXCLUDE =					\
	.gitignore				\
	.gitmodules				\
	gnome-shell.doap			\
	HACKING					\
	MAINTAINERS				\
	po/change_msgid.sh			\
	po/eos-desktop.pot			\
	tools/build/*				\
	.tx/config

distcheck-hook:
	@echo "Checking disted files against files in git"
	@$(srcdir)/tools/check-for-missing.py $(srcdir) $(distdir) $(DIST_EXCLUDE)

AM_DISTCHECK_CONFIGURE_FLAGS = --enable-gtk-doc --enable-man

# Pass resource paths to EOS_JS_COVERAGE_FILES
EOS_JS_COVERAGE_FILES = $(shell python -c "import xml.etree.ElementTree as ET; import sys; tree = ET.parse('js/js-resources.gresource.xml'); map(sys.stdout.write, ['resource://org/gnome/shell/{0}\n'.format(e.text) for e in tree.getroot()[0]])")

@EOS_COVERAGE_RULES@

AM_CFLAGS = @EOS_COVERAGE_CFLAGS@
AM_LDFLAGS = @EOS_COVERAGE_LDFLAGS@

echo-cov-files:
	@echo @EOS_JS_COVERAGE_LOG_FLAGS@
