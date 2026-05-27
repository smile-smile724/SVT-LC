import trimesh
import numpy as np
import os
import sys

print("开始生成超大规模的 3D 测试模型，请稍候...")

# 创建一个精细度较高的基础球体 (大约 1 万个面)
base_shape = trimesh.creation.icosphere(subdivisions=5)

# 复制成一个矩阵阵列
meshes = []
grid_size = 8  # 8x8x8 = 512 个球体，总共约 524 万个面，刚好能把体积撑到 ~100MB 左右

for x in range(grid_size):
    for y in range(grid_size):
        for z in range(grid_size):
            m = base_shape.copy()
            # 随机做点形变或位移，让它更像一个复杂的非重复场景
            offset = np.random.rand(3) * 0.5
            m.apply_translation([x * 5 + offset[0], y * 5 + offset[1], z * 5 + offset[2]])
            meshes.append(m)

print(f"总计合并了 {len(meshes)} 个高精度网格...")
scene = trimesh.Scene(meshes)

output_path = r"e:\s\Desktop\MTweb\mtweb-system\packages\preprocess\scenes\raw\large-model.glb"
print("正在执行 GLB 导出（可能需要十几秒压缩时间）...")
scene.export(output_path)

mb_size = os.path.getsize(output_path) / (1024 * 1024)
print(f"✅ 成功生成大模型！文件路径: {output_path}")
print(f"✅ 模型体积: {mb_size:.2f} MB")
