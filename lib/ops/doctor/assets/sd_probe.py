# Vetted System Doctor probe. Prints one line and exits. No files, no network.
import bpy
import sys

print("SDPROBE OK " + bpy.app.version_string)
sys.exit(0)
