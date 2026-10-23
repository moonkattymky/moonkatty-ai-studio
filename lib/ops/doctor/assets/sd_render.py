# Vetted System Doctor render. Builds a cube, saves a .blend, writes one 64x64 PNG.
# Paths come from argv after "--", and only from the doctor's temp directory.
import bpy
import sys

argv = sys.argv
sep = argv.index("--")
blend = argv[sep + 1]
png = argv[sep + 2]
if ".." in blend or ".." in png:
    sys.exit(3)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
bpy.ops.wm.save_as_mainfile(filepath=blend)
scene = bpy.context.scene
engine = "BLENDER_WORKBENCH"
for name in ("BLENDER_WORKBENCH", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = name
        engine = name
        break
    except TypeError:
        continue
scene.render.resolution_x = 64
scene.render.resolution_y = 64
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = png
bpy.ops.render.render(write_still=True)
print("SDRENDER OK " + engine)
