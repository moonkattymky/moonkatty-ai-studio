# Prints a JSON line with the Blender version, Python API and available engines/exporters (headless probe).
import bpy, sys, json
sc = bpy.context.scene; eng = []
for n in ("CYCLES", "BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
    try: sc.render.engine = n; eng.append(n)
    except TypeError: pass
print("MKPROBE " + json.dumps({"version": bpy.app.version_string, "versionTuple": list(bpy.app.version), "python": sys.version.split()[0],
  "engines": eng, "gltf": hasattr(bpy.ops.export_scene, "gltf"), "fbx": hasattr(bpy.ops.export_scene, "fbx"), "background": bpy.app.background}))
