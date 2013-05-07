#!/bin/bash

echo "deb http://http.us.debian.org/debian experimental main" > /etc/apt/sources.list.d/debian-experimental.list
sudo apt-get update
#sudo apt-get -y install autotools-dev cdbs debhelper dh-autoreconf gnome-bluetooth gnome-control-center-dev=3.4 gnome-pkg-tools=0.11 gobject-introspection=1.29.15 gsettings-desktop-schemas-dev=3.7.4 gtk-doc-tools intltool=0.26 libatk-bridge2.0-dev libcanberra-dev libcanberra-gtk3-dev libcaribou-dev=0.4.8 libclutter-1.0-dev=1.13.4 libcroco3-dev=0.6.8 libdbus-glib-1-dev libecal1.2-dev=3.8.0-2 libedataserver1.2-dev=3.8.0-2 libgirepository1.0-dev=1.29.15 libgjs-dev=1.35.4 libglib2.0-dev=2.31.6 libgnome-bluetooth-dev=3.5.5 libgnome-desktop-3-dev=3.8.0-2 libsecret-1-dev libgnome-menu-3-dev=3.5.3 libgstreamer1.0-dev=0.11.92 libgtk-3-dev=3.7.9 libibus-1.0-dev libmutter-dev=3.8.0 libnm-glib-dev=0.9.8 libnm-glib-vpn-dev=0.9.8 libnm-gtk-dev=0.9.6 libnm-util-dev=0.9 libpolkit-agent-1-dev=0.100 libpulse-dev=2.0 libstartup-notification0-dev=0.11 libtelepathy-glib-dev=0.17.5 libx11-dev libxfixes-dev libxml2-dev python libgcr-3-dev=3.3.90
sudo apt-get -y --force-yes install autotools-dev cdbs debhelper dh-autoreconf gnome-bluetooth gnome-control-center-dev gnome-pkg-tools gobject-introspection gsettings-desktop-schemas-dev gtk-doc-tools intltool libatk-bridge2.0-dev libcanberra-dev libcanberra-gtk3-dev libcaribou-dev libclutter-1.0-dev libcroco3-dev libdbus-glib-1-dev libedataserver1.2-dev=3.8.0-2 libgirepository1.0-dev libgjs-dev libglib2.0-dev libgnome-bluetooth-dev libgnome-desktop-3-dev libsecret-1-dev libgnome-menu-3-dev libgstreamer1.0-dev libgtk-3-dev libibus-1.0-dev libmutter-dev libnm-glib-dev libnm-glib-vpn-dev libnm-gtk-dev libnm-util-dev libpolkit-agent-1-dev libpulse-dev libstartup-notification0-dev libtelepathy-glib-dev libx11-dev libxfixes-dev libxml2-dev python libgcr-3-dev libedataserver-1.2-17=3.8.0-2 gir1.2-edataserver-1.2=3.8.0-2 libcamel1.2-dev=3.8.0-2 libedataserver1.2-dev=3.8.0-2 libedata-book1.2-dev=3.8.0-2 libebackend1.2-dev=3.8.0-2 libebook1.2-dev=3.8.0-2 gir1.2-ebook-1.2=3.8.0-2 libebook-1.2-14=3.8.0-2 libecal-1.2-15=3.8.0-2 libecal1.2-dev=3.8.0-2 libsdl1.2-dev libglade2-dev libgtkglext1-dev evolution-data-server-common=3.8.0-2 gir1.2-ecalendar-1.2=3.8.0-2

#autoreconf --install
#aclocal
#intltoolize --force
#autoreconf

#./autogen.sh
#./configure

#debuild
