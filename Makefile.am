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
if EOS_COVERAGE_ENABLED
AM_DISTCHECK_CONFIGURE_FLAGS += --enable-coverage --with-coverage-dir=@EOS_COVERAGE_DIR@
endif EOS_COVERAGE_ENABLED

AM_CFLAGS = @EOS_COVERAGE_CFLAGS@
AM_LDFLAGS = @EOS_COVERAGE_LDFLAGS@

coverage-cobertura:
	$(MAKE) $(AM_MAKEFLAGS) -f test/Makefile coverage-cobertura

coverage-genhtml:
	$(MAKE) $(AM_MAKEFLAGS) -f test/Makefile coverage-genhtml
