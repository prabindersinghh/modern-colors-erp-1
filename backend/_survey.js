const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const blocked = await p.material.findMany({
    where: { balanceKg: null },
    select: { id:true, uniqueId:true, materialName:true, sku:true, unit:true, weight:true, status:true },
    orderBy: { uniqueId:'asc' },
  });
  console.log('blocked units (balanceKg null):', blocked.length);
  // Group by material+unit so we can assign one sensible weight per material.
  const g = new Map();
  for (const m of blocked) {
    const k = `${m.sku || m.materialName}|${m.unit || '-'}`;
    if (!g.has(k)) g.set(k, { name:m.materialName, sku:m.sku, unit:m.unit, n:0 });
    g.get(k).n++;
  }
  console.log('distinct material+unit groups:', g.size, '\n');
  console.log('count | unit    | sku          | material');
  [...g.values()].sort((a,b)=>b.n-a.n).forEach(v =>
    console.log(String(v.n).padStart(5), '|', String(v.unit||'-').padEnd(7), '|',
                String(v.sku||'-').slice(0,12).padEnd(12), '|', v.name.slice(0,46)));
  await p.$disconnect();
})();
