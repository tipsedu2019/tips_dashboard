import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const feature = new URL('../src/features/textbooks/', import.meta.url);
const handoffUrl = new URL('textbook-handoff-model.ts', feature);
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('./') && context.parentURL?.startsWith(feature.href)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
} });

const textbook = { id: 'book', title: '교재 2', subject: 'english', publisher: '출판사', sale_price: 10001, default_supplier_id: 'supplier' };
const order = (id) => ({ id, status: 'ordered', requested_by: '김쌤', supplier_id: 'supplier' });
const purchaseLine = (id, extra = {}) => ({ id, textbook_id: 'book', purchase_order_id: 'o1', class_id: 'class', location_id: 'main', copy_scope: 'student', status: 'ordered', ordered_quantity: 2, received_quantity: 1, ...extra });
const purchaseInput = () => ({
  rows: [purchaseLine('student'), purchaseLine('teacher', { purchase_order_id: 'o2', copy_scope: 'teacher', ordered_quantity: 1, received_quantity: 1, location_id: 'annex' }), purchaseLine('request', { status: 'requested', ordered_quantity: 99 })],
  ordersById: new Map([['o1', order('o1')], ['o2', order('o2')]]), textbooks: [textbook],
  publishers: [], suppliers: [{ id: 'supplier', name: '외부', contact: '담당' }], publisherSupplierLinks: [],
  locations: [{ id: 'main', name: '본관' }, { id: 'annex', name: '별관' }], classes: [{ id: 'class', name: '중2반' }],
});
async function assertLiteralOutputs(api) {
  const [group] = api.buildPurchaseSupplierHandoffGroups(purchaseInput());
  assert.equal(group.id, 'supplier'); assert.equal(group.totalQuantity, 3); assert.equal(group.totalAmount, 18002);
  assert.deepEqual(group.summary, ['1종', '학생용 2권', '교사용 1권', '3권', '18,002원']);
  assert.deepEqual(group.lines, [{ id: 'supplier||book', title: '교재 2', detail: '학생용/교사용 · 출판사 · 중2반 · 본관, 별관',
    note: '부분 입고, 입고 완료 · 요청 김쌤 · 잔여 1권', quantityLabel: '학생용 2권 · 교사용 1권', amountLabel: '18,002원',
    locationLabel: '본관: 학생용 2권, 교사용 0권 · 별관: 학생용 0권, 교사용 1권',
    locationQuantities: [{ locationLabel: '본관', studentQuantityLabel: '2권', teacherQuantityLabel: '0권' }, { locationLabel: '별관', studentQuantityLabel: '0권', teacherQuantityLabel: '1권' }],
    publisherLabel: '출판사', studentQuantityLabel: '2권', teacherQuantityLabel: '1권', unitCostLabel: '9,001원' }]);
  assert.match(group.message, /총 주문금액: 18,002원/);
  const returns = purchaseInput(); returns.rows = returns.rows.map((line) => ({ ...line, status: line.id === 'student' ? 'partially_received' : 'received' }));
  returns.rows[2].received_quantity = 0;
  const [returned] = api.buildPurchaseSupplierReturnHandoffGroups(returns);
  assert.equal(returned.totalQuantity, 2); assert.equal(returned.totalAmount, 9001);
  assert.equal(returned.lines[0].quantityLabel, '학생용 1권 · 교사용 1권');
  assert.equal(returned.summary[0], '반품 요청서');
  const billing = api.buildMakeEduBillingHandoffGroups({
    rows: [{ id: 'real-line', student_id: 'student', textbook_id: 'book', class_id: 'class', quantity: 2, unit_price: 0, charge_month: '2026-08', status: 'paid' },
      { id: 'teacher-line', textbook_id: 'book', copy_scope: 'teacher', status: 'charged' },
      { id: 'excluded-line', textbook_id: 'book', status: 'excluded' }],
    salesById: new Map(), textbooks: [textbook], classes: [{ id: 'class', name: '중2반' }], studentsById: new Map([['student', { id: 'student', name: '학생', grade: '중2' }]]),
  });
  assert.deepEqual(billing.map((group) => Object.fromEntries(Object.entries(group).filter(([key]) => key !== 'message'))), [{ id: '2026-08:[영어 교재] 교재 2 20002:20002', title: '[영어 교재] 교재 2 20002', subtitle: '수납시작: 2026-08',
    summary: ['1명', '2권', '20,002원'], lines: [{ id: 'real-line', title: '학생', detail: '중2 · 중2반', note: '수량 2 · 출고 대기', quantityLabel: '1명', amountLabel: '20,002원' }], totalQuantity: 2, totalAmount: 20002 }]);
}
test('extracted pure handoff model preserves literal existing order, return and billing outputs', async () => {
  assert.ok(existsSync(handoffUrl), 'pure handoff module must exist independently of React workspace');
  await assertLiteralOutputs(await import(handoffUrl));
});

test('workspace imports and invokes the single extracted implementations of all three builders', () => {
  const workspace = readFileSync(new URL('textbook-operations-workspace.tsx', feature), 'utf8');
  const imports = workspace.match(/import \{([^}]+)\} from "\.\/textbook-handoff-model";/)?.[1].split(/[,\s]+/) || [];
  for (const name of ['buildPurchaseSupplierHandoffGroups', 'buildPurchaseSupplierReturnHandoffGroups', 'buildMakeEduBillingHandoffGroups']) {
    assert.ok(imports.includes(name), `${name} is imported`);
    assert.ok(new RegExp(`${name}\\(`).test(workspace), `${name} is invoked`);
    assert.ok(!new RegExp(`function ${name}\\b`).test(workspace), `${name} has one implementation`);
  }
});

test('teacher-only and zero-price handoffs preserve zero formatting without billing teacher copies', async () => {
  const api = await import(handoffUrl);
  const input = purchaseInput();
  input.rows = [purchaseLine('teacher', { copy_scope: 'teacher', ordered_quantity: 3 })];
  const [teacher] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(teacher.totalAmount, 0); assert.equal(teacher.lines[0].amountLabel, '-');
  assert.equal(teacher.lines[0].unitCostLabel, '0원');
  assert.deepEqual(teacher.summary, ['1종', '교사용 3권', '3권']);
  input.textbooks = [{ ...textbook, sale_price: 0 }];
  input.rows = [purchaseLine('student', { ordered_quantity: 1, unit_cost: 0 })];
  const [zero] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(zero.totalAmount, 0); assert.equal(zero.lines[0].unitCostLabel, '-');
  const groups = api.buildMakeEduBillingHandoffGroups({ rows: [
    { id: 'one', textbook_id: 'book', charge_month: '2026-08', quantity: 1, unit_price: 10.1 },
    { id: 'two', textbook_id: 'book', charge_month: '2026-08', quantity: 1, unit_price: 10.2 },
    { id: 'zero', textbook_id: 'missing', charge_month: '2026-08', quantity: 0, unit_price: 0 },
  ], salesById: new Map(), textbooks: [textbook], classes: [], studentsById: new Map() });
  assert.equal(groups.length, 3, 'rounded fee title does not collapse different exact amounts');
  assert.deepEqual(groups.flatMap((group) => group.lines.map((line) => [line.id, line.quantityLabel, line.amountLabel])).sort(), [
    ['one', '1명', '10.1원'], ['two', '1명', '10.2원'], ['zero', '1명', '-'],
  ]);
});

test('repeated student and teacher source lines accumulate across orders without relaxing order or return eligibility', async () => {
  const api = await import(handoffUrl);
  const input = purchaseInput();
  input.rows = [
    purchaseLine('student-a'),
    purchaseLine('student-b', { purchase_order_id: 'o2', ordered_quantity: 3, received_quantity: 0 }),
    purchaseLine('teacher-a', { copy_scope: 'teacher', ordered_quantity: 1, location_id: 'annex' }),
    purchaseLine('teacher-b', { purchase_order_id: 'o2', copy_scope: 'teacher', ordered_quantity: 2, received_quantity: 0 }),
    purchaseLine('partial', { status: 'partially_received', ordered_quantity: 4, received_quantity: 1 }),
    purchaseLine('zero', { ordered_quantity: 0, requested_quantity: 99, received_quantity: 0 }),
    purchaseLine('cancelled', { status: 'cancelled', ordered_quantity: 10 }),
    purchaseLine('returned', { status: 'returned', ordered_quantity: 5 }),
    purchaseLine('received', { status: 'received', ordered_quantity: 4, received_quantity: 4 }),
    purchaseLine('requested', { status: 'requested', requested_quantity: 99 }),
  ];
  const groups = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(groups.length, 1); assert.equal(groups[0].lines.length, 1);
  assert.equal(groups[0].totalQuantity, 12); assert.equal(groups[0].totalAmount, 81009);
  assert.deepEqual(groups[0].lines[0].locationQuantities, [
    { locationLabel: '본관', studentQuantityLabel: '9권', teacherQuantityLabel: '2권' },
    { locationLabel: '별관', studentQuantityLabel: '0권', teacherQuantityLabel: '1권' },
  ]);
  assert.equal(groups[0].lines[0].quantityLabel, '학생용 9권 · 교사용 3권');
  assert.equal(groups[0].lines[0].note, '부분 입고, 주문 외 1 · 요청 김쌤 · 잔여 4권');
  const returned = api.buildPurchaseSupplierReturnHandoffGroups(input);
  assert.equal(returned.length, 1); assert.equal(returned[0].totalQuantity, 5);
  assert.equal(returned[0].totalAmount, 45005);
  assert.equal(returned[0].lines[0].quantityLabel, '학생용 5권');
});

test('configured publisher links retain primary priority, direct supplier precedence and TIPS zero cost', async () => {
  const api = await import(handoffUrl);
  const input = purchaseInput();
  input.rows = [purchaseLine('student', { received_quantity: 0 })];
  input.textbooks = [{ ...textbook, default_supplier_id: '', publisher: '  출판사  ' }];
  input.publishers = [{ id: 'publisher', name: '출판사' }];
  input.suppliers.push({ id: 'tips', name: '팁스서점' });
  input.publisherSupplierLinks = [
    { publisher_id: 'publisher', supplier_id: 'tips', is_primary: false, priority: 0 },
    { publisher_id: 'publisher', supplier_id: 'supplier', is_primary: true, priority: 99 },
  ];
  const [external] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(external.id, 'supplier'); assert.equal(external.totalAmount, 18002);
  input.textbooks[0].default_supplier_id = 'tips';
  const [tips] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(tips.id, 'tips'); assert.equal(tips.totalAmount, 0);
  assert.equal(tips.lines[0].unitCostLabel, '0원'); assert.equal(tips.lines[0].amountLabel, '-');
  input.textbooks[0].sale_price = 0;
  input.rows[0].unit_cost = 123;
  const [fallback] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(fallback.totalAmount, 246, 'missing catalog price keeps legacy explicit unit-cost fallback');
  assert.equal(fallback.lines[0].unitCostLabel, '123원');
});
