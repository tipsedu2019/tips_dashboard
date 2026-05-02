import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const notionPageUrl = (id) => `https://app.notion.com/p/${id.replaceAll("-", "")}`;

const DATA_SOURCES = {
  englishStock: {
    subject: "english",
    pageId: "e361ef13-bef2-4439-b256-1de4a4ac8d80",
    publisherCollectionId: "097e26fa-80e2-4dcd-ab77-183b509c2be4",
  },
  mathStock: {
    subject: "math",
    pageId: "ac1e8238-ff81-43e4-940c-fcfdab9a7b9f",
    publisherCollectionId: "16fade65-0855-4296-a6f0-8bab845b9e84",
  },
  englishPublishers: {
    pageId: "fd272781-35ae-4b5f-a62d-b938187b4c96",
    collectionId: "097e26fa-80e2-4dcd-ab77-183b509c2be4",
  },
  mathPublishers: {
    pageId: "4b425166-a433-4930-a6ec-8a85adec9e13",
    collectionId: "16fade65-0855-4296-a6f0-8bab845b9e84",
  },
};

const PUBLISHER_CATALOG = [
  ["2efbd6d4-d474-80a3-becc-c39ce3d766d6", "입시플라이", "english"],
  ["6393dc64-de9e-4d42-9784-ec642e6ea3b7", "백발백중", "english", "우생당"],
  ["568e392a-5a5a-46cc-a69a-72c648cecab0", "신사고", "english", "영주교육"],
  ["c443e75f-397d-44a0-b843-90238530f9d6", "개념원리", "english", "영주교육"],
  ["1c8d8616-5dac-4717-9f7b-b6de76b6649d", "비상교육", "english", "영주교육"],
  ["a96cf254-a35f-4684-9524-94069207ae52", "진학사", "english", "영주교육"],
  ["6180e038-0ca0-4ecd-9c13-119c1885861c", "해커스", "english", "영주교육"],
  ["82403503-fd3b-494a-bcf9-8f4ceae82b63", "마더텅", "english", "한라서적"],
  ["baea3527-9024-4742-a045-9f7dbf3771cd", "천재교육", "english", "우생당"],
  ["e595d470-85de-458a-87a9-2aa03dc49f3e", "지학사", "english", "영주교육"],
  ["0000a53f-0e3a-4fa0-9435-ca1aa6a9e5c4", "다락원", "english", "대진서점(신진도서)"],
  ["4b4cc30d-5e39-4b6c-8358-a0f83fd46e8e", "이엔비", "english"],
  ["1809f156-ee81-4cda-a144-47b90ac31e05", "디딤돌", "english", "영주교육"],
  ["2c9241d6-3f70-4c81-bec6-564c5eadefb2", "이투스", "english", "영주교육"],
  ["4ef2218f-7168-46a2-8cce-5c5b1abed386", "팁스서점", "english", "팁스서점"],
  ["f943194b-5c06-4417-b449-74dd0cbf6d68", "희망출판", "english", "영주교육"],
  ["224e309a-ccfb-41dd-be07-85b2821f4238", "경선", "english", "영주교육"],
  ["a73bd56e-4d50-42fe-93dc-f42bee3c5d6e", "브릭스", "english", "영주교육"],
  ["066cd66a-437f-42ac-bb62-3cfa528854f2", "메가스터디", "english", "영주교육"],
  ["128286fb-6248-419b-8600-6f7ada901d4a", "능률", "english", "영주교육"],
  ["e4ab58b1-009f-4fe2-80fb-b3ddb2890397", "동아출판", "english", "우생당"],
  ["fa2cbaee-69f7-4618-a395-9666583838b4", "미래엔에듀", "english", "현대서점"],
  ["6da2a7e7-9449-46fb-984c-c9bef0b3010f", "에듀플라자", "english", "영주교육"],
  ["866f336c-ef07-4942-8358-0e01ffff1da1", "쎄듀", "english", "영주교육"],
  ["96e28abb-e204-4b55-8ff8-69c88cd03a89", "수경출판사", "english", "영주교육"],
  ["9306b1c6-686e-4d78-813f-609e8536fea2", "백발백중", "math", "우생당"],
  ["bd0e818d-a90e-4d36-ba2a-228fdbc7502a", "개념원리", "math", "영주교육"],
  ["436e967c-04bc-4ca9-8544-f103c8b49338", "진학사", "math", "영주교육"],
  ["713b38ff-04d7-47dc-9364-f0f30870ffeb", "신사고", "math", "영주교육"],
  ["14f72e6a-9d55-4886-bb1f-98a52371ff8f", "팁스서점", "math", "팁스서점"],
  ["58e84dd3-3e50-4e95-a88f-5763b12d0c06", "비상교육", "math", "영주교육"],
  ["e61e1466-3624-4487-9c70-26733afcafd1", "지학사", "math", "영주교육"],
  ["27217973-db3f-42c8-9d62-67b7368eed36", "천재교육", "math", "우생당"],
  ["5ce7cdc9-d884-4b61-bce3-dded766734d3", "시대인재북스", "math"],
  ["2b3b6380-aff6-4089-8c86-7f9ce78ae121", "메가스터디", "math", "영주교육"],
  ["3476d353-f229-463d-bbd9-a0102802589b", "미래엔에듀", "math", "현대서점"],
  ["4b47f981-7c20-494a-9223-f5f0ada1653b", "동아출판", "math", "우생당"],
  ["ee1b523d-eff2-470d-839e-fa36d490846b", "수경출판", "math", "영주교육"],
  ["8e2194a0-8c34-4ac0-839a-7d53b06e9ac7", "이투스", "math", "영주교육"],
  ["9121cece-74c0-48f8-a363-0f83237bf902", "희망출판", "math", "영주교육"],
  ["aacf55dd-1896-4484-8fb9-9afab7fda5a2", "능률", "math", "영주교육"],
  ["b7e9f539-a18b-4b3c-b37a-f7baa7b184a5", "성지출판사", "math", "영주교육"],
  ["17cddddb-7e43-4026-9171-7601d9489a42", "디딤돌", "math", "영주교육"],
  ["728564ec-a6e4-4e3b-bc37-e6277af37428", "투데이", "math", "영주교육"],
  ["15692859-b239-4413-a3c7-74a4eeed593d", "입시플라이", "math", "현대서점"],
  ["37c09d4a-9d82-45c8-8ee4-ad8cee21bf1c", "한국교육방송공사", "math"],
  ["6f23944c-9e8d-4757-8f4e-56bf61797f89", "EBS", "math", "우생당"],
  ["1c4bd6d4-d474-80d9-bb81-ddac9b273c50", "csm", "math", "영주교육"],
];

const SUPPLIER_NAMES = ["영주교육", "우생당", "한라서적", "현대서점", "대진서점(신진도서)", "팁스서점"];

function sql(value) {
  if (value === null || value === undefined || value === "") return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlArray(values) {
  const safeValues = [...new Set((values || []).filter(Boolean))];
  return safeValues.length > 0 ? `array[${safeValues.map(sql).join(", ")}]::text[]` : "'{}'::text[]";
}

function unwrap(record) {
  return record?.value?.value || record?.value || record || {};
}

function richTextToText(value) {
  if (!Array.isArray(value)) return "";
  return value.map((part) => (Array.isArray(part) ? String(part[0] || "") : "")).join("").trim();
}

function numberFromProperty(value) {
  const numeric = Number(richTextToText(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function relationIds(value) {
  const ids = new Set();
  const walk = (part) => {
    if (!Array.isArray(part)) return;
    if (part[0] === "p" && typeof part[1] === "string") ids.add(part[1]);
    for (const item of part) walk(item);
  };
  walk(value);
  return [...ids];
}

function propertyIdByName(schema, name) {
  return Object.entries(schema).find(([, property]) => property.name === name)?.[0] || "";
}

function relationPropertyIdByCollection(schema, collectionId) {
  return Object.entries(schema).find(([, property]) => property.collection_id === collectionId)?.[0] || "";
}

async function notionPost(endpoint, body) {
  const response = await fetch(`https://www.notion.so/api/v3/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${endpoint} ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchDataSourceRows(config) {
  const page = await notionPost("loadPageChunk", {
    pageId: config.pageId,
    limit: 100,
    cursor: { stack: [] },
    chunkNumber: 0,
    verticalColumns: false,
  });
  const collectionId = Object.keys(page.recordMap?.collection || {})[0];
  const collectionViewId = Object.keys(page.recordMap?.collection_view || {})[0];
  if (!collectionId || !collectionViewId) {
    throw new Error(`Notion data source could not be loaded: ${config.pageId}`);
  }

  const collection = unwrap(page.recordMap.collection[collectionId]);
  const collectionView = unwrap(page.recordMap.collection_view[collectionViewId]);
  const query = await notionPost("queryCollection?src=initial_load", {
    collection: { id: collectionId },
    collectionView: { id: collectionViewId },
    source: { type: "collection", id: collectionId },
    loader: {
      type: "reducer",
      reducers: {
        collection_group_results: {
          type: "results",
          limit: 999,
          loadContentCover: true,
        },
      },
      sort: [],
      ...(collectionView.query2 || {}),
      filter: {
        filters: collectionView.query2?.filter?.filters || [],
        operator: "and",
      },
      searchQuery: "",
      userTimeZone: "Asia/Seoul",
    },
  });

  const blockIds = query.result?.reducerResults?.collection_group_results?.blockIds || [];
  return {
    schema: collection.schema || {},
    rows: blockIds.map((id) => ({
      id,
      url: notionPageUrl(id),
      properties: unwrap(query.recordMap.block[id]).properties || {},
    })),
  };
}

function buildPublisherCatalog() {
  const byId = new Map();
  const byName = new Map();

  for (const [id, name, subject, supplierName] of PUBLISHER_CATALOG) {
    const existing = byName.get(name) || {
      name,
      subjects: [],
      sourceUrls: [],
      suppliers: [],
    };
    existing.subjects = [...new Set([...existing.subjects, subject])];
    existing.sourceUrls = [...new Set([...existing.sourceUrls, notionPageUrl(id)])];
    if (supplierName) existing.suppliers = [...new Set([...existing.suppliers, supplierName])];
    byName.set(name, existing);
    byId.set(id, existing);
  }

  return { byId, byName };
}

function parseStockRows({ subject, publisherCollectionId }, dataSource, publisherById) {
  const titleProperty = propertyIdByName(dataSource.schema, "교재명") || "title";
  const categoryProperty = propertyIdByName(dataSource.schema, "구분");
  const priceProperty = propertyIdByName(dataSource.schema, "판매단가");
  const statusProperty = propertyIdByName(dataSource.schema, "상태");
  const returnableProperty = propertyIdByName(dataSource.schema, "반품교재");
  const publisherProperty = relationPropertyIdByCollection(dataSource.schema, publisherCollectionId);

  return dataSource.rows
    .map((row) => {
      const publisherId = relationIds(row.properties[publisherProperty])[0] || "";
      const publisher = publisherById.get(publisherId);
      const title = richTextToText(row.properties[titleProperty]);
      if (!title) return null;
      return {
        id: row.id,
        title,
        subject,
        category: richTextToText(row.properties[categoryProperty]),
        price: numberFromProperty(row.properties[priceProperty]),
        status: richTextToText(row.properties[statusProperty]) || "사용중",
        isReturnable: richTextToText(row.properties[returnableProperty]).toLowerCase() === "yes",
        publisherName: publisher?.name || "",
        sourceNotionUrl: row.url,
      };
    })
    .filter(Boolean);
}

function buildMigrationSql({ textbooks, publishers }) {
  const publisherRows = [...publishers.byName.values()].sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
  const supplierNames = [...new Set([...SUPPLIER_NAMES, ...publisherRows.flatMap((publisher) => publisher.suppliers)])].sort((left, right) =>
    left.localeCompare(right, "ko-KR"),
  );
  const links = publisherRows.flatMap((publisher) =>
    publisher.suppliers.map((supplierName, index) => ({ publisherName: publisher.name, supplierName, priority: index + 1 })),
  );

  return [
    "-- Generated from Notion 교재 DB(2024~): 재고표 + 출판사 DB",
    "insert into public.textbook_suppliers (name)",
    `values\n${supplierNames.map((name) => `  (${sql(name)})`).join(",\n")}`,
    "on conflict (name) do update set name = excluded.name;",
    "",
    "insert into public.textbook_publishers (name, subjects, source_notion_url, source_notion_urls)",
    `values\n${publisherRows
      .map(
        (publisher) =>
          `  (${sql(publisher.name)}, ${sqlArray(publisher.subjects)}, ${sql(publisher.sourceUrls[0])}, ${sqlArray(publisher.sourceUrls)})`,
      )
      .join(",\n")}`,
    "on conflict (name) do update",
    "set subjects = excluded.subjects,",
    "    source_notion_url = coalesce(public.textbook_publishers.source_notion_url, excluded.source_notion_url),",
    "    source_notion_urls = excluded.source_notion_urls;",
    "",
    links.length > 0
      ? [
          "insert into public.textbook_publisher_supplier_links (publisher_id, supplier_id, priority, is_primary)",
          "select publisher.id, supplier.id, source.priority, source.priority = 1",
          "from (values",
          links.map((link) => `  (${sql(link.publisherName)}, ${sql(link.supplierName)}, ${link.priority})`).join(",\n"),
          ") as source(publisher_name, supplier_name, priority)",
          "join public.textbook_publishers publisher on publisher.name = source.publisher_name",
          "join public.textbook_suppliers supplier on supplier.name = source.supplier_name",
          "on conflict (publisher_id, supplier_id) do update",
          "set priority = excluded.priority,",
          "    is_primary = excluded.is_primary;",
        ].join("\n")
      : "",
    "",
    "insert into public.textbooks (id, title, name, subject, category, publisher, publisher_id, default_supplier_id, price, list_price, sale_price, status, is_returnable, source_notion_url)",
    `values\n${textbooks
      .map((textbook) => {
        const status = textbook.status === "미사용" ? "미사용" : "사용중";
        return `  (${sql(textbook.id)}::uuid, ${sql(textbook.title)}, ${sql(textbook.title)}, ${sql(textbook.subject)}, ${sql(textbook.category)}, ${sql(textbook.publisherName)}, (select id from public.textbook_publishers where name = ${sql(textbook.publisherName)}), (select supplier_id from public.textbook_publisher_supplier_links link join public.textbook_publishers publisher on publisher.id = link.publisher_id where publisher.name = ${sql(textbook.publisherName)} order by link.priority asc limit 1), ${textbook.price}, ${textbook.price}, ${textbook.price}, ${sql(status)}, ${textbook.isReturnable ? "true" : "false"}, ${sql(textbook.sourceNotionUrl)})`;
      })
      .join(",\n")}`,
    "on conflict (id) do update",
    "set title = excluded.title,",
    "    name = excluded.name,",
    "    subject = excluded.subject,",
    "    category = excluded.category,",
    "    publisher = excluded.publisher,",
    "    publisher_id = excluded.publisher_id,",
    "    default_supplier_id = excluded.default_supplier_id,",
    "    price = excluded.price,",
    "    list_price = excluded.list_price,",
    "    sale_price = excluded.sale_price,",
    "    status = excluded.status,",
    "    is_returnable = excluded.is_returnable,",
    "    source_notion_url = excluded.source_notion_url;",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const publishers = buildPublisherCatalog();
  const [englishStock, mathStock] = await Promise.all([
    fetchDataSourceRows(DATA_SOURCES.englishStock),
    fetchDataSourceRows(DATA_SOURCES.mathStock),
  ]);
  const textbooks = [
    ...parseStockRows(DATA_SOURCES.englishStock, englishStock, publishers.byId),
    ...parseStockRows(DATA_SOURCES.mathStock, mathStock, publishers.byId),
  ];

  const sqlSource = buildMigrationSql({ textbooks, publishers });
  const migrationPath = join(root, "supabase", "migrations", "20260429150000_import_textbook_notion_master.sql");
  await mkdir(dirname(migrationPath), { recursive: true });
  await writeFile(migrationPath, sqlSource, "utf8");

  console.log(`Notion stock rows: ${textbooks.length}`);
  console.log(`Notion publisher rows: ${publishers.byName.size}`);
  console.log(`Wrote ${migrationPath}`);
}

await main();
