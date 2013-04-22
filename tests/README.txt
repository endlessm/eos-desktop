# Make sure that you run from within jhbuild shell and that you export these paths from within it

export GI_TYPELIB_PATH=$JHBUILD_LIBDIR/gnome-shell:$JHBUILD_LIBDIR/mutter/:$JHBUILD_LIBDIR/girepository-1.0:/usr/lib/girepository-1.0:/usr/lib/gnome-bluetooth
export LD_LIBRARY_PATH=$JHBUILD_LIBDIR:$JHBUILD_LIBDIR/gnome-shell
