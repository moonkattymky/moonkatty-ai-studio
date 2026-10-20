# MOONKATTY AI STUDIO — vetted, parameterized Blender template (no code from the LLM is executed here).
# Usage: blender -b --factory-startup --python-exit-code 3 --python scene_basic.py -- <mode> <params.json> <version_dir>
#   mode = build   : build the scene from params, save <version_dir>/scene.blend
#   mode = render  : OPEN the saved scene.blend (proves save+reopen), render renders/preview.png, optional animation, exports
# Writes <version_dir>/logs/<mode>-result.json. Any exception → exit code 3 (Blender --python-exit-code).
import bpy, sys, os, json, math, traceback
argv = sys.argv[sys.argv.index("--") + 1:]
mode, params_path, vdir = argv[0], argv[1], argv[2]
P = json.load(open(params_path, encoding="utf-8"))
vdir = os.path.realpath(vdir)
def out(rel):
    p = os.path.realpath(os.path.join(vdir, rel))
    if not p.startswith(vdir + os.sep): raise RuntimeError("path escapes version dir: " + rel)
    return p
def result(d):
    d.update(mode=mode, blender=bpy.app.version_string)
    with open(out(f"logs/{mode}-result.json"), "w", encoding="utf-8") as f: json.dump(d, f, ensure_ascii=False, indent=1)

def material(name, rgb, metallic, roughness):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1.0); b.inputs["Metallic"].default_value = metallic; b.inputs["Roughness"].default_value = roughness
    m.diffuse_color = (*rgb, 1.0)  # used by Workbench
    return m
def add(op, mat, **kw):
    op(**kw); o = bpy.context.object; o.data.materials.append(mat); return o
def smooth(o):
    for p in o.data.polygons: p.use_smooth = True

def build_subject(mat, eye_mat):
    s = P["subject"]; objs = []
    if s == "cat":  # stylized MOONKATTY-like cat from primitives
        body = add(bpy.ops.mesh.primitive_uv_sphere_add, mat, radius=1.0, location=(0, 0, 1.0), segments=48, ring_count=24); body.scale = (1, 0.85, 1.05); body.name = "Body"
        head = add(bpy.ops.mesh.primitive_uv_sphere_add, mat, radius=0.72, location=(0, -0.25, 2.35), segments=48, ring_count=24); head.name = "Head"
        for sx in (-1, 1):
            ear = add(bpy.ops.mesh.primitive_cone_add, mat, radius1=0.28, depth=0.55, location=(0.4 * sx, -0.2, 3.05)); ear.rotation_euler = (0, 0.35 * sx, 0); ear.name = "Ear" + ("L" if sx < 0 else "R")
            eye = add(bpy.ops.mesh.primitive_uv_sphere_add, eye_mat, radius=0.11, location=(0.26 * sx, -0.88, 2.45)); eye.name = "Eye" + ("L" if sx < 0 else "R")
            objs += [ear, eye]
        tail = add(bpy.ops.mesh.primitive_torus_add, mat, major_radius=0.6, minor_radius=0.1, location=(0, 0.95, 0.9)); tail.rotation_euler = (math.radians(90), 0, 0); tail.name = "Tail"
        objs += [body, head, tail]
    else:
        ops = {"cube": bpy.ops.mesh.primitive_cube_add, "sphere": bpy.ops.mesh.primitive_uv_sphere_add, "monkey": bpy.ops.mesh.primitive_monkey_add,
               "cylinder": bpy.ops.mesh.primitive_cylinder_add, "torus": bpy.ops.mesh.primitive_torus_add, "cone": bpy.ops.mesh.primitive_cone_add}
        o = add(ops[s], mat, location=(0, 0, 1.2)); o.name = "Subject"; objs.append(o)
    for o in objs:
        if not (o.name == "Subject" and s in ("cube", "cone", "cylinder")): smooth(o)
    return objs

def look_at(obj, target):
    import mathutils
    d = mathutils.Vector(target) - obj.location; obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

def lights():
    kind = P["lighting"]
    if kind == "sun":
        bpy.ops.object.light_add(type="SUN", location=(4, -4, 8)); bpy.context.object.data.energy = 4
    else:
        rigs = [((4, -4, 5), 800), ((-4, -3, 3), 300), ((0, 4, 5), 500)] if kind == "three_point" else [((3, -3, 4), 600), ((-3, -3, 4), 600), ((0, 0, 7), 400)]
        for loc, e in rigs:
            bpy.ops.object.light_add(type="AREA", location=loc); L = bpy.context.object; L.data.energy = e; L.data.size = 3; look_at(L, (0, 0, 1.2))

def engine(scene):
    want = P["render"]["engine"]
    names = {"CYCLES": ["CYCLES"], "EEVEE": ["BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"], "WORKBENCH": ["BLENDER_WORKBENCH"]}[want]
    if want == "CYCLES":
        import addon_utils; addon_utils.enable("cycles", default_set=True)
    for n in names:
        try: scene.render.engine = n; break
        except TypeError: continue
    else: raise RuntimeError("render engine not available: " + want)
    if scene.render.engine == "CYCLES":
        scene.cycles.device = "CPU"; scene.cycles.samples = P["render"]["samples"]; scene.cycles.use_denoising = False
    elif "EEVEE" in scene.render.engine:
        try: scene.eevee.taa_render_samples = P["render"]["samples"]
        except Exception: pass
    scene.render.resolution_x = P["render"]["width"]; scene.render.resolution_y = P["render"]["height"]; scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

try:
    if mode == "build":
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene; sc.name = "MOONKATTY"
        mat = material("MK_Main", P["color"], P["metallic"], P["roughness"]); eye = material("MK_Eye", (0.02, 0.02, 0.02), 0.0, 0.1)
        objs = build_subject(mat, eye)
        floor = add(bpy.ops.mesh.primitive_plane_add, material("MK_Floor", (0.12, 0.12, 0.16), 0.0, 0.8), size=20, location=(0, 0, 0)); floor.name = "Floor"
        lights()
        bpy.ops.object.camera_add(location=(0, -P["camera"]["distance"], P["camera"]["height"] + 1.2)); cam = bpy.context.object; cam.name = "Camera"
        cam.data.lens = P["camera"]["focal"]; look_at(cam, (0, 0, 1.4)); sc.camera = cam
        w = bpy.data.worlds.new("MK_World"); sc.world = w; w.use_nodes = True
        bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs["Color"].default_value = (*P["background"], 1.0)
        n = P["animation"]["frames"]
        if n > 0:  # turntable: rotate the camera around the subject on an empty pivot
            bpy.ops.object.empty_add(location=(0, 0, 0)); piv = bpy.context.object; piv.name = "TurntablePivot"; cam.parent = piv
            sc.frame_start, sc.frame_end = 1, n; piv.rotation_euler = (0, 0, 0); piv.keyframe_insert("rotation_euler", frame=1)
            piv.rotation_euler = (0, 0, math.radians(360 * (n - 1) / n)); piv.keyframe_insert("rotation_euler", frame=n)
            for fc in (piv.animation_data.action.fcurves if hasattr(piv.animation_data.action, "fcurves") else []):
                for k in fc.keyframe_points: k.interpolation = "LINEAR"
        engine(sc); sc["mk_title"] = P["title"]
        bpy.ops.wm.save_as_mainfile(filepath=out("scene.blend"), compress=False)
        result({"ok": True, "objects": sorted(o.name for o in bpy.data.objects), "materials": sorted(m.name for m in bpy.data.materials), "blend": "scene.blend"})
    elif mode == "render":
        bpy.ops.wm.open_mainfile(filepath=out("scene.blend"))  # reopen the saved file
        sc = bpy.context.scene
        if sc.camera is None: raise RuntimeError("reopened scene has no camera")
        sc.render.filepath = out("renders/preview.png"); bpy.ops.render.render(write_still=True)
        files = ["renders/preview.png"]
        if sc.frame_end > sc.frame_start and P["animation"]["frames"] > 0:
            sc.render.filepath = out("renders/anim/frame_"); bpy.ops.render.render(animation=True)
            files += sorted("renders/anim/" + f for f in os.listdir(out("renders/anim")))
        if "glb" in P["exports"]: bpy.ops.export_scene.gltf(filepath=out("exports/scene.glb"), export_format="GLB"); files.append("exports/scene.glb")
        if "fbx" in P["exports"]: bpy.ops.export_scene.fbx(filepath=out("exports/scene.fbx")); files.append("exports/scene.fbx")
        result({"ok": True, "engine": sc.render.engine, "objects": sorted(o.name for o in bpy.data.objects), "files": files})
    else:
        raise RuntimeError("unknown mode " + mode)
except Exception as e:
    try: result({"ok": False, "error": str(e), "trace": traceback.format_exc()[-3000:]})
    except Exception: pass
    raise
