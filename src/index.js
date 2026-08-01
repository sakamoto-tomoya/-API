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

function parseBirthdate(value) {
  const normalized = String(value || "").replace(/\D/g, "");

  if (!/^\d{8}$/.test(normalized)) {
    throw new Error("birthdateはYYYYMMDD形式の8桁で入力してください");
  }

  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("birthdateの日付が正しくありません");
  }

  return {
    normalized,
    year,
    month,
    day,
  };
}

function countFiveElements(pillars) {
  const stemElements = {
    甲: "木",
    乙: "木",
    丙: "火",
    丁: "火",
    戊: "土",
    己: "土",
    庚: "金",
    辛: "金",
    壬: "水",
    癸: "水",
  };

  const branchElements = {
    子: "水",
    丑: "土",
    寅: "木",
    卯: "木",
    辰: "土",
    巳: "火",
    午: "火",
    未: "土",
    申: "金",
    酉: "金",
    戌: "土",
    亥: "水",
  };

  const balance = {
    木: 0,
    火: 0,
    土: 0,
    金: 0,
    水: 0,
  };

  const byPillar = {};

  for (const [name, pillar] of Object.entries(pillars)) {
    const stem = pillar.slice(0, 1);
    const branch = pillar.slice(1, 2);
    const stemElement = stemElements[stem] || "";
    const branchElement = branchElements[branch] || "";

    if (stemElement) {
      balance[stemElement] += 1;
    }

    if (branchElement) {
      balance[branchElement] += 1;
    }

    byPillar[name] = {
      pillar,
      stem,
      branch,
      stem_element: stemElement,
      branch_element: branchElement,
    };
  }

  return {
    by_pillar: byPillar,
    balance,
  };
}

function getHiddenStems(lunarDate) {
  const eightChar = lunarDate.getEightChar();

  return {
    year: eightChar.getYearHideGan(),
    month: eightChar.getMonthHideGan(),
    day: eightChar.getDayHideGan(),
  };
}

function calculateShichusuimei(birthdate) {
  const { normalized, year, month, day } = parseBirthdate(birthdate);
  const solar = Solar.fromYmd(year, month, day);
  const lunarDate = solar.getLunar();
  const eightChar = lunarDate.getEightChar();

  const pillars = {
    year: eightChar.getYear(),
    month: eightChar.getMonth(),
    day: eightChar.getDay(),
  };

  const fiveElements = countFiveElements(pillars);

  return {
    birthdate: normalized,
    calculation_type: "出生時刻を使用しない年月日の三柱計算",
    year_pillar: pillars.year,
    month_pillar: pillars.month,
    day_pillar: pillars.day,
    day_master: pillars.day.slice(0, 1),
    five_elements_by_pillar: fiveElements.by_pillar,
    five_element_balance: fiveElements.balance,
    hidden_stems: getHiddenStems(lunarDate),
  };
}

function calculateKyuseikigaku(birthdate) {
  const { normalized, year, month, day } = parseBirthdate(birthdate);
  const solar = Solar.fromYmd(year, month, day);
  const lunarDate = solar.getLunar();

  const yearNineStar = lunarDate.getYearNineStar(2);
  const monthNineStar = lunarDate.getMonthNineStar(2);
  const dayNineStar = lunarDate.getDayNineStar();

  return {
    birthdate: normalized,
    year_star: {
      name: yearNineStar.toString(),
      number: yearNineStar.getNumber(),
      element: yearNineStar.getWuXing(),
      direction: yearNineStar.getPositionDesc(),
    },
    month_star: {
      name: monthNineStar.toString(),
      number: monthNineStar.getNumber(),
      element: monthNineStar.getWuXing(),
      direction: monthNineStar.getPositionDesc(),
    },
    day_star: {
      name: dayNineStar.toString(),
      number: dayNineStar.getNumber(),
      element: dayNineStar.getWuXing(),
      direction: dayNineStar.getPositionDesc(),
    },
  };
}

function reduceToSingleDigit(value, keepMasterNumber = false) {
  let number = Math.abs(Number(value));

  while (number > 9) {
    if (
      keepMasterNumber &&
      (number === 11 || number === 22 || number === 33)
    ) {
      return number;
    }

    number = String(number)
      .split("")
      .reduce((sum, digit) => sum + Number(digit), 0);
  }
    return number;
}

function calculateWesternAstrology(birthdate) {
  const { normalized, year, month, day } = parseBirthdate(birthdate);
  const dateNumber = month * 100 + day;

  const signs = [
    { name: "山羊座", english: "Capricorn", element: "地", start: 1222, end: 119 },
    { name: "水瓶座", english: "Aquarius", element: "風", start: 120, end: 218 },
    { name: "魚座", english: "Pisces", element: "水", start: 219, end: 320 },
    { name: "牡羊座", english: "Aries", element: "火", start: 321, end: 419 },
    { name: "牡牛座", english: "Taurus", element: "地", start: 420, end: 520 },
    { name: "双子座", english: "Gemini", element: "風", start: 521, end: 620 },
    { name: "蟹座", english: "Cancer", element: "水", start: 621, end: 722 },
    { name: "獅子座", english: "Leo", element: "火", start: 723, end: 822 },
    { name: "乙女座", english: "Virgo", element: "地", start: 823, end: 922 },
    { name: "天秤座", english: "Libra", element: "風", start: 923, end: 1022 },
    { name: "蠍座", english: "Scorpio", element: "水", start: 1023, end: 1121 },
    { name: "射手座", english: "Sagittarius", element: "火", start: 1122, end: 1221 },
  ];

  const sunSign = signs.find((sign) => {
    if (sign.name === "山羊座") {
      return dateNumber >= 1222 || dateNumber <= 119;
    }

    return dateNumber >= sign.start && dateNumber <= sign.end;
  });

  return {
    birthdate: normalized,
    year,
    month,
    day,
    calculation_type: "生年月日による太陽星座",
    sun_sign: sunSign,
  };
}

function calculateFengShui(birthdate, gender) {
  const { normalized, year } = parseBirthdate(birthdate);
  const normalizedGender = String(gender || "").trim();
  const isMale =
    normalizedGender === "男性" ||
    normalizedGender.toLowerCase() === "male";
  const isFemale =
    normalizedGender === "女性" ||
    normalizedGender.toLowerCase() === "female";

  if (!isMale && !isFemale) {
    throw new Error("genderは男性または女性で入力してください");
  }

  const yearDigit = reduceToSingleDigit(
    String(year)
      .split("")
      .reduce((sum, digit) => sum + Number(digit), 0)
  );

  let kuaNumber;

  if (year < 2000) {
    kuaNumber = isMale
      ? 10 - yearDigit
      : reduceToSingleDigit(yearDigit + 5);
  } else {
    kuaNumber = isMale
      ? 9 - yearDigit
      : reduceToSingleDigit(yearDigit + 6);
  }

  if (kuaNumber === 0) {
    kuaNumber = 9;
  }

  if (kuaNumber === 5) {
    kuaNumber = isMale ? 2 : 8;
  }

  const kuaData = {
    1: { trigram: "坎", element: "水", direction: "北", group: "東四命" },
    2: { trigram: "坤", element: "土", direction: "南西", group: "西四命" },
    3: { trigram: "震", element: "木", direction: "東", group: "東四命" },
    4: { trigram: "巽", element: "木", direction: "南東", group: "東四命" },
    6: { trigram: "乾", element: "金", direction: "北西", group: "西四命" },
    7: { trigram: "兌", element: "金", direction: "西", group: "西四命" },
    8: { trigram: "艮", element: "土", direction: "北東", group: "西四命" },
    9: { trigram: "離", element: "火", direction: "南", group: "東四命" },
  };

  return {
    birthdate: normalized,
    gender: normalizedGender,
    calculation_type: "生年と性別による本命卦",
    kua_number: kuaNumber,
    kua: kuaData[kuaNumber],
  };
}

function getTokyoCurrentYear() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).formatToParts(new Date());

  const yearPart = parts.find((part) => part.type === "year");
  return Number(yearPart?.value || new Date().getUTCFullYear());
}

function calculateSpiritual(birthdate) {
  const { normalized, month, day } = parseBirthdate(birthdate);
  const digitTotal = normalized
    .split("")
    .reduce((sum, digit) => sum + Number(digit), 0);

  const calculationYear = getTokyoCurrentYear();

  return {
    birthdate: normalized,
    calculation_type: "生年月日による数秘術",
    life_path_number: reduceToSingleDigit(digitTotal, true),
    birthday_number: reduceToSingleDigit(day, true),
    attitude_number: reduceToSingleDigit(month + day, true),
    personal_year: {
      year: calculationYear,
      number: reduceToSingleDigit(
        reduceToSingleDigit(month) +
          reduceToSingleDigit(day) +
          reduceToSingleDigit(calculationYear),
        true
      ),
    },
  };
}

async function getKanjiStrokeCount(character) {
  const response = await fetch(
    `https://kanjiapi.dev/v1/kanji/${encodeURIComponent(character)}`
  );

  if (!response.ok) {
    return {
      character,
      success: false,
      stroke_count: null,
    };
  }

  const data = await response.json();

  return {
    character,
    success: true,
    stroke_count: data.stroke_count,
  };
}

async function calculateSeimeihandan(
  userName,
  surnameInput = "",
  givenNameInput = ""
) {
  const normalizedName = String(userName || "")
    .trim()
    .replace(/　/g, " ");
  const nameParts = normalizedName.split(/\s+/).filter(Boolean);
  const surname =
    String(surnameInput || "").trim() ||
    (nameParts.length === 2 ? nameParts[0] : "");
  const givenName =
    String(givenNameInput || "").trim() ||
    (nameParts.length === 2 ? nameParts[1] : "");

  if (!surname || !givenName) {
    return {
      success: false,
      error: "姓名判断には姓と名の区切りが必要です。例：山田 太郎",
      requires_name_split: true,
    };
  }

  const surnameCharacters = [...surname];
  const givenNameCharacters = [...givenName];
  const surnameStrokes = await Promise.all(
    surnameCharacters.map(getKanjiStrokeCount)
  );
  const givenNameStrokes = await Promise.all(
    givenNameCharacters.map(getKanjiStrokeCount)
  );
  const unsupportedCharacters = [
    ...surnameStrokes,
    ...givenNameStrokes,
  ].filter((item) => !item.success);

  if (unsupportedCharacters.length > 0) {
    return {
      success: false,
      error: "画数を取得できない文字が含まれています",
      unsupported_characters: unsupportedCharacters.map(
        (item) => item.character
      ),
    };
  }

  const surnameNumbers = surnameStrokes.map(
    (item) => item.stroke_count
  );
  const givenNameNumbers = givenNameStrokes.map(
    (item) => item.stroke_count
  );
  const surnameTotal = surnameNumbers.reduce(
    (sum, value) => sum + value,
    0
  );
  const givenNameTotal = givenNameNumbers.reduce(
    (sum, value) => sum + value,
    0
  );
  const heaven =
    surnameTotal + (surnameNumbers.length === 1 ? 1 : 0);
  const person =
    surnameNumbers[surnameNumbers.length - 1] +
    givenNameNumbers[0];
  const earth =
    givenNameTotal + (givenNameNumbers.length === 1 ? 1 : 0);
  const total = surnameTotal + givenNameTotal;
  const outer =
    total -
    person +
    (surnameNumbers.length === 1 ? 1 : 0) +
    (givenNameNumbers.length === 1 ? 1 : 0);

  return {
    success: true,
    calculation_type: "五格による姓名判断",
    full_name: `${surname} ${givenName}`,
    surname,
    given_name: givenName,
    stroke_counts: {
      surname: surnameStrokes,
      given_name: givenNameStrokes,
    },
    five_grids: {
      heaven,
      person,
      earth,
      outer,
      total,

    },
  };
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
      { error: "line_user_idとfortune_typeは必須です" },
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
    return jsonResponse({ error: "PDFファイルが空です" }, 400);
  }

  const objectKey = `${receptionNumber}.pdf`;

  await env.BUCKET.put(objectKey, pdf, {
    httpMetadata: {
      contentType: "application/pdf",
      contentDisposition: `attachment; filename="${objectKey}"`,
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
        download_expires_at = datetime(?, 'unixepoch'),
        delivery_status = 'ready',
        updated_at = CURRENT_TIMESTAMP
      WHERE reception_number = ?
      `
    )
    .bind(objectKey, expiresAt, receptionNumber)
    .run();

  return jsonResponse({
    success: true,
    reception_number: receptionNumber,
    download_url: downloadUrl,
    expires_at: expiresAt,
  });
}

async function downloadPdf(request, env, url) {
  const receptionNumber = decodeURIComponent(
    url.pathname.replace("/download/", "")
  );

  const expiresAt = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") || "";

  if (!isValidReceptionNumber(receptionNumber)) {
    return jsonResponse(
      { error: "受付番号の形式が正しくありません" },
      400
    );
  }

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return jsonResponse(
      { error: "ダウンロードURLの有効期限が切れています" },
      403
    );
  }

  const expectedSignature = await createSignature(
    env.DOWNLOAD_SECRET,
    `${receptionNumber}:${expiresAt}`
  );

  if (signature !== expectedSignature) {
    return jsonResponse(
      { error: "ダウンロードURLが正しくありません" },
      403
    );
  }

  const order = await getOrder(env, receptionNumber);

  if (!order || !order.pdf_object_key) {
    return jsonResponse(
      { error: "PDFが見つかりません" },
      404
    );
  }

  const object = await env.BUCKET.get(order.pdf_object_key);

  if (!object) {
    return jsonResponse(
      { error: "PDFファイルが見つかりません" },
      404
    );
  }

  const headers = new Headers();

  object.writeHttpMetadata(headers);

  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  headers.set(
    "content-disposition",
    `attachment; filename="${receptionNumber}.pdf"`
  );

  return new Response(object.body, {
    status: 200,
    headers,
  });
}

async function readOrder(request, env, url) {
  if (!isAuthorized(request, env)) {
    return jsonResponse(
      { error: "認証に失敗しました" },
      401
    );
  }

  const receptionNumber = decodeURIComponent(
    url.pathname.replace("/orders/", "")
  );

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

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (
        request.method === "GET" &&
        path === "/health"
      ) {
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
        request.method === "POST" &&
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
        return await readOrder(request, env, url);
      }

      if (
        request.method === "POST" &&
        path === "/fortune/shichusuimei"
      ) {
        if (!isAuthorized(request, env)) {
          return jsonResponse(
            { error: "認証に失敗しました" },
            401
          );
        }

        const body = await request.json();

        if (!body.birthdate) {
          return jsonResponse(
            { error: "birthdateは必須です" },
            400
          );
        }

        const calculation = calculateShichusuimei(
          body.birthdate
        );

        return jsonResponse({
          success: true,
          fortune_type: "四柱推命",
          birthdate: body.birthdate,
          calculation,
        });
      }

      if (
        request.method === "POST" &&
        path === "/fortune/kyuseikigaku"
      ) {
        if (!isAuthorized(request, env)) {
          return jsonResponse(
            { error: "認証に失敗しました" },
            401
          );
        }

        const body = await request.json();

        if (!body.birthdate) {
          return jsonResponse(
            { error: "birthdateは必須です" },
            400
          );
        }

        const calculation = calculateKyuseikigaku(
          body.birthdate
        );

        return jsonResponse({
          success: true,
          fortune_type: "九星気学",
          birthdate: body.birthdate,
          calculation,
        });
      }

      if (
        request.method === "POST" &&
        path === "/fortune/seimeihandan"
      ) {
        if (!isAuthorized(request, env)) {
          return jsonResponse(
            { error: "認証に失敗しました" },
            401
          );
        }

        const body = await request.json();

        if (!body.user_name) {
          return jsonResponse(
            { error: "user_nameは必須です" },
            400
          );
        }

        const calculation =
          await calculateSeimeihandan(
            body.user_name,
            body.surname,
            body.given_name
          );

        if (!calculation.success) {
          return jsonResponse(
            {
              success: false,
              fortune_type: "姓名判断",
              calculation,
            },
            422
          );
        }

        return jsonResponse({
          success: true,
          fortune_type: "姓名判断",
          user_name: body.user_name,
          calculation,
        });
      }

      if (
        request.method === "POST" &&
        path === "/fortune/western-astrology"
      ) {
        if (!isAuthorized(request, env)) {
          return jsonResponse(
            { error: "認証に失敗しました" },
            401
          );
        }

        const body = await request.json();

        if (!body.birthdate) {
          return jsonResponse(
            { error: "birthdateは必須です" },
            400
          );
        }

        const calculation =
          calculateWesternAstrology(
            body.birthdate
          );

        return jsonResponse({
          success: true,
          fortune_type: "西洋占星術",
          birthdate: body.birthdate,
          calculation,
        });
      }
            if (
        request.method === "POST" &&
        path === "/fortune/fengshui"
      ) {
        if (!isAuthorized(request, env)) {
          return jsonResponse(
            { error: "認証に失敗しました" },
            401
          );
        }

        const body = await request.json();

        if (!body.birthdate || !body.gender) {
          return jsonResponse(
            {
              error:
                "birthdateとgenderは必須です",
            },
            400
          );
        }

        const calculation = calculateFengShui(
          body.birthdate,
          body.gender
        );

        return jsonResponse({
          success: true,
          fortune_type: "風水",
          birthdate: body.birthdate,
          gender: body.gender,
          period: body.period || "",
          calculation,
        });
      }

      if (
        request.method === "POST" &&
        path === "/fortune/spiritual"
      ) {
        if (!isAuthorized(request, env)) {
          return jsonResponse(
            { error: "認証に失敗しました" },
            401
          );
        }

        const body = await request.json();

        if (!body.birthdate) {
          return jsonResponse(
            { error: "birthdateは必須です" },
            400
          );
        }

        const calculation = calculateSpiritual(
          body.birthdate
        );

        return jsonResponse({
          success: true,
          fortune_type: "スピ系",
          user_name: body.user_name || "",
          birthdate: body.birthdate,
          gender: body.gender || "",
          period: body.period || "",
          calculation,
        });
      }

      return jsonResponse(
        { error: "指定された処理はありません" },
        404
      );
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "処理中にエラーが発生しました",
        },
        500
      );
    }
  },
};
