import lunar from "lunar-javascript";

const { Solar } = lunar;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
}

function isAuthorized(request, env) {
  return getBearerToken(request) === env.API_TOKEN;
}

function isValidReceptionNumber(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{4,80}$/.test(value)
  );
}

function bytesToBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function createSignature(secret, message) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return bytesToBase64Url(new Uint8Array(signature));
}

async function getOrder(env, receptionNumber) {
  return await env.DB
    .prepare(
      `
      SELECT *
      FROM orders
      WHERE reception_number = ?
      LIMIT 1
      `
    )
    .bind(receptionNumber)
    .first();
}

async function registerOrder(request, env) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "認証に失敗しました" }, 401);
  }

  const body = await request.json();

  const receptionNumber = body.reception_number;
  const lineUserId = body.line_user_id;
  const fortuneType = body.fortune_type;

  if (!isValidReceptionNumber(receptionNumber)) {
    return jsonResponse(
      { error: "受付番号の形式が正しくありません" },
      400
    );
  }

  if (!lineUserId || !fortuneType) {
    return jsonResponse(
      {
        error:
          "line_user_idとfortune_typeは必須です",
      },
      400
    );
  }

  await env.DB
    .prepare(
      `
      INSERT INTO orders (
        reception_number,
        line_user_id,
        fortune_type,
        user_name,
        birthdate,
        gender,
        period,
        request_json,
        payment_status,
        delivery_status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)

      ON CONFLICT(reception_number) DO UPDATE SET
        line_user_id = excluded.line_user_id,
        fortune_type = excluded.fortune_type,
        user_name = excluded.user_name,
        birthdate = excluded.birthdate,
        gender = excluded.gender,
        period = excluded.period,
        request_json = excluded.request_json,
        updated_at = CURRENT_TIMESTAMP
      `
    )
    .bind(
      receptionNumber,
      lineUserId,
      fortuneType,
      body.user_name || null,
      body.birthdate || null,
      body.gender || null,
      body.period || null,
      JSON.stringify(body.request_json || {})
    )
    .run();

  return jsonResponse({
    success: true,
    reception_number: receptionNumber,
  });
}

async function confirmPayment(request, env) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "認証に失敗しました" }, 401);
  }

  const body = await request.json();
  const receptionNumber = body.reception_number;

  if (!isValidReceptionNumber(receptionNumber)) {
    return jsonResponse(
      { error: "受付番号の形式が正しくありません" },
      400
    );
  }

  const order = await getOrder(env, receptionNumber);

  if (!order) {
    return jsonResponse(
      { error: "受付番号に対応する注文がありません" },
      404
    );
  }

  if (body.payment_status !== "paid") {
    return jsonResponse(
      { error: "支払い済みではありません" },
      400
    );
  }

  if (Number(body.amount_total) !== 10500) {
    return jsonResponse(
      { error: "決済金額が10,500円ではありません" },
      400
    );
  }

  await env.DB
    .prepare(
      `
      UPDATE orders
      SET
        payment_status = ?,
        stripe_event_id = ?,
        checkout_session_id = ?,
        customer_email = ?,
        amount_total = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE reception_number = ?
      `
    )
    .bind(
      body.payment_status,
      body.event_id || null,
      body.checkout_session_id || null,
      body.email || null,
      Number(body.amount_total),
      receptionNumber
    )
    .run();

  return jsonResponse({
    success: true,
    reception_number: receptionNumber,
    line_user_id: order.line_user_id,
    fortune_type: order.fortune_type,
    user_name: order.user_name,
    birthdate: order.birthdate,
    gender: order.gender,
    period: order.period,
  });
}

async function uploadPdf(request, env, url) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "認証に失敗しました" }, 401);
  }

  const receptionNumber =
    url.searchParams.get("reception_number") || "";

  if (!isValidReceptionNumber(receptionNumber)) {
    return jsonResponse(
      { error: "受付番号の形式が正しくありません" },
      400
    );
  }

  const order = await getOrder(env, receptionNumber);

  if (!order) {
    return jsonResponse(
      { error: "受付番号に対応する注文がありません" },
      404
    );
  }

  if (order.payment_status !== "paid") {
    return jsonResponse(
      { error: "決済が確認できていません" },
      403
    );
  }

  const pdf = await request.arrayBuffer();

  if (pdf.byteLength === 0) {
    return jsonResponse(
      { error: "PDFファイルが空です" },
      400
    );
  }

  const objectKey = `${receptionNumber}.pdf`;

  await env.BUCKET.put(objectKey, pdf, {
    httpMetadata: {
      contentType: "application/pdf",
      contentDisposition:
        `attachment; filename="${objectKey}"`,
    },
    customMetadata: {
      reception_number: receptionNumber,
    },
  });

  const expiresAt =
    Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  const message = `${receptionNumber}:${expiresAt}`;

  const signature = await createSignature(
    env.DOWNLOAD_SECRET,
    message
  );

  const downloadUrl =
    `${url.origin}/download/` +
    `${encodeURIComponent(receptionNumber)}` +
    `?exp=${expiresAt}&sig=${encodeURIComponent(signature)}`;

  await env.DB
    .prepare(
      `
      UPDATE orders
      SET
        pdf_object_key = ?,
        download_expires_at =
          datetime(?, 'unixepoch'),
        delivery_status = 'ready',
        updated_at = CURRENT_TIMESTAMP
      WHERE reception_number = ?
      `
    )
    .bind(
      objectKey,
      expiresAt,
      receptionNumber
    )
    .run();

  return jsonResponse({
    success: true,
    reception_number: receptionNumber,
    download_url: downloadUrl,
    expires_at: expiresAt,
  });
}

async function downloadPdf(request, env, url) {
  const pathParts = url.pathname.split("/");
  const receptionNumber =
    decodeURIComponent(pathParts[2] || "");

  const expiresAt = Number(url.searchParams.get("exp"));
  const receivedSignature =
    url.searchParams.get("sig") || "";

  if (
    !isValidReceptionNumber(receptionNumber) ||
    !Number.isInteger(expiresAt) ||
    !receivedSignature
  ) {
    return new Response("無効なURLです", { status: 400 });
  }

  if (Math.floor(Date.now() / 1000) > expiresAt) {
    return new Response(
      "ダウンロード期限が終了しています",
      { status: 410 }
    );
  }

  const expectedSignature = await createSignature(
    env.DOWNLOAD_SECRET,
    `${receptionNumber}:${expiresAt}`
  );

  if (receivedSignature !== expectedSignature) {
    return new Response("署名が正しくありません", {
      status: 403,
    });
  }

  const order = await getOrder(env, receptionNumber);

  if (!order || !order.pdf_object_key) {
    return new Response(
      "鑑定書が見つかりません",
      { status: 404 }
    );
  }

  const object = await env.BUCKET.get(
    order.pdf_object_key
  );

  if (!object || !object.body) {
    return new Response(
      "PDFファイルが見つかりません",
      { status: 404 }
    );
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition":
        `attachment; filename="${receptionNumber}.pdf"`,
      "cache-control": "private, no-store",
      "content-length": String(object.size),
    },
  });
}

async function readOrder(request, env, receptionNumber) {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "認証に失敗しました" }, 401);
  }

  if (!isValidReceptionNumber(receptionNumber)) {
    return jsonResponse(
      { error: "受付番号の形式が正しくありません" },
      400
    );
  }

  const order = await getOrder(env, receptionNumber);

  if (!order) {
    return jsonResponse(
      { error: "注文が見つかりません" },
      404
    );
  }

  return jsonResponse({
    success: true,
    order,
  });
}
function parseBirthdate(value) {
  const digits = String(value ?? "").replace(/\D/g, "");

  if (!/^\d{8}$/.test(digits)) {
    throw new Error("生年月日は19750405のような8桁で入力してください");
  }

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));

  const solar = Solar.fromYmd(year, month, day);
  const normalized =
    `${String(year).padStart(4, "0")}` +
    `${String(month).padStart(2, "0")}` +
    `${String(day).padStart(2, "0")}`;

  if (solar.toYmd().replaceAll("-", "") !== normalized) {
    throw new Error("存在しない生年月日です");
  }

  return {
    year,
    month,
    day,
    normalized,
    solar
  };
}

function countFiveElements(values) {
  const counts = {
    木: 0,
    火: 0,
    土: 0,
    金: 0,
    水: 0
  };

  for (const value of values) {
    for (const element of String(value)) {
      if (Object.hasOwn(counts, element)) {
        counts[element] += 1;
      }
    }
  }

  return counts;
}

async function calculateShichusuimei(request, env) {
  if (!isAuthorized(request, env)) {
    return jsonResponse(
      {
        success: false,
        error: "認証に失敗しました"
      },
      401
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        success: false,
        error: "JSON本文を確認してください"
      },
      400
    );
  }

  try {
    const parsed = parseBirthdate(body.birthdate);
    const lunarDate = parsed.solar.getLunar();
    const eightChar = lunarDate.getEightChar();

    const pillars = {
      year: eightChar.getYear(),
      month: eightChar.getMonth(),
      day: eightChar.getDay()
    };

    const fiveElements = {
      year: eightChar.getYearWuXing(),
      month: eightChar.getMonthWuXing(),
      day: eightChar.getDayWuXing()
    };

    return jsonResponse({
      success: true,
      fortune_type: "四柱推命",
      birthdate: parsed.normalized,
      calculation: {
        year_pillar: pillars.year,
        month_pillar: pillars.month,
        day_pillar: pillars.day,
        day_master: eightChar.getDayGan(),
        five_elements_by_pillar: fiveElements,
        five_element_balance: countFiveElements(
          Object.values(fiveElements)
        ),
        hidden_stems: {
          year: eightChar.getYearHideGan(),
          month: eightChar.getMonthHideGan(),
          day: eightChar.getDayHideGan()
        }
      }
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      400
    );
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET" && path === "/health") {
        return jsonResponse({
          success: true,
          service: "uranai-api",
        });
      }

      if (
        request.method === "POST" &&
        path === "/orders/register"
      ) {
        return await registerOrder(request, env);
      }

      if (
        request.method === "POST" &&
        path === "/payments/confirm"
      ) {
        return await confirmPayment(request, env);
      }

      if (
        request.method === "PUT" &&
        path === "/pdf/upload"
      ) {
        return await uploadPdf(request, env, url);
      }

      if (
        request.method === "GET" &&
        path.startsWith("/download/")
      ) {
        return await downloadPdf(request, env, url);
      }

      if (
        request.method === "GET" &&
        path.startsWith("/orders/")
      ) {
        const receptionNumber =
          decodeURIComponent(path.split("/")[2] || "");

        return await readOrder(
          request,
          env,
          receptionNumber
        );
      }
if (
  request.method === "POST" &&
  path === "/fortune/shichusuimei"
) {
  return await calculateShichusuimei(request, env);
}    
      return jsonResponse(
        { error: "指定された処理はありません" },
        404
      );
    } catch (error) {
      console.error(error);

      return jsonResponse(
        {
          error: "サーバー処理に失敗しました",
          detail:
            error instanceof Error
              ? error.message
              : String(error),
        },
        500
      );
    }
  },
};

