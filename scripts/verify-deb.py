#!/usr/bin/env python3
"""Validate the actual Debian artifact and its software-center integration."""

import configparser
import pathlib
import shlex
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(package):
    package = pathlib.Path(package).resolve()
    require(package.is_file(), f"Package does not exist: {package}")
    fields = subprocess.check_output(
        ["dpkg-deb", "--field", str(package)], text=True
    )
    control = dict(
        line.split(": ", 1) for line in fields.splitlines()
        if ": " in line and not line.startswith(" ")
    )
    require(control.get("Description") not in (None, "", "(none)"),
            "Debian package description is missing")

    with tempfile.TemporaryDirectory(prefix="stockfolio-deb-check-") as temp:
        root = pathlib.Path(temp)
        subprocess.run(["dpkg-deb", "--extract", str(package), temp], check=True)
        metadata_files = list((root / "usr/share/metainfo").glob("*.metainfo.xml"))
        require(len(metadata_files) == 1, "Expected one AppStream metadata file")
        metadata = metadata_files[0]
        subprocess.run(["appstreamcli", "validate", "--no-net", str(metadata)],
                       check=True)
        component = ET.parse(metadata).getroot()
        require(component.get("type") == "desktop-application",
                "AppStream component must be a desktop application")
        require(metadata.name == f"{component.findtext('id')}.metainfo.xml",
                "AppStream filename and component ID disagree")
        launchable = component.find("launchable[@type='desktop-id']")
        require(launchable is not None and launchable.text,
                "AppStream metadata must identify the desktop launcher")
        desktop_id = launchable.text
        require(pathlib.Path(desktop_id).name == desktop_id,
                "Desktop ID must be a filename")
        desktop = root / "usr/share/applications" / desktop_id
        require(desktop.is_file(), f"AppStream launcher is missing: {desktop_id}")
        subprocess.run(["desktop-file-validate", str(desktop)], check=True)
        entry = configparser.ConfigParser(interpolation=None)
        entry.read(desktop)
        app = entry["Desktop Entry"]
        require(app.get("Type") == "Application", "Launcher is not an application")
        require(app.get("Name") == component.findtext("name"),
                "Desktop and AppStream application names disagree")
        require(app.get("NoDisplay", "false").lower() != "true" and
                app.get("Hidden", "false").lower() != "true",
                "Application must be visible")
        require("Finance" in app.get("Categories", "").split(";"),
                "Desktop finance category is missing")
        executable = shlex.split(app["Exec"])[0]
        require(executable == control["Package"],
                "Launcher executable and Debian package identity disagree")
        require((root / "usr/bin" / executable).is_file(),
                "Launcher executable is missing from the package")
        require(component.findtext("provides/binary") == executable,
                "AppStream binary and launcher executable disagree")
        icon = app.get("Icon", "")
        require(icon and any(
            path.stem == icon for path in (root / "usr/share/icons").rglob("*")
            if path.suffix in (".png", ".svg", ".xpm")
        ), "Launcher icon is missing from the package")
        releases = component.findall("releases/release")
        require(any(release.get("version") == control["Version"] for release in releases),
                "AppStream releases must include the Debian package version")
    print(f"Verified {package.name}: package, AppStream, launcher, executable, icon")


if __name__ == "__main__":
    try:
        require(len(sys.argv) > 1, "Usage: python3 scripts/verify-deb.py PACKAGE.deb [...]")
        for tool in ("dpkg-deb", "appstreamcli", "desktop-file-validate"):
            require(shutil.which(tool),
                    f"Missing {tool}; install appstream and desktop-file-utils")
        for argument in sys.argv[1:]:
            verify(argument)
    except (ValueError, KeyError, ET.ParseError, subprocess.CalledProcessError) as error:
        sys.exit(f"Debian package verification failed: {error}")
