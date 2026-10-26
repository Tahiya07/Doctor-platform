/**
 * The two languages of the website. Each person has one (users.language), kept in step with the
 * website's language button, and the emails they receive are written in it.
 */
export const asLanguage = (value) => (value === "bn" ? "bn" : "en");

/** The language named by the X-Language header the website sends, or undefined when it sent none. */
export const languageFromRequest = (request) => {
  const value = request.get("x-language");
  return value === "bn" || value === "en" ? value : undefined;
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const bnDigits = (value) => String(value).replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]);

/** Digits in the language: 60 → "৬০" in Bengali, unchanged in English. */
export const num = (language, value) => (language === "bn" ? bnDigits(value) : String(value));

const MONTHS_BN = [
  "জানুয়ারি",
  "ফেব্রুয়ারি",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টেম্বর",
  "অক্টোবর",
  "নভেম্বর",
  "ডিসেম্বর",
];

/** A calendar day, "26 October 2026" or "২৬ অক্টোবর ২০২৬". */
export function dayText(language, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      day: "numeric",
      month: "numeric",
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  if (language !== "bn")
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Dhaka",
    });
  return `${bnDigits(parts.day)} ${MONTHS_BN[Number(parts.month) - 1]} ${bnDigits(parts.year)}`;
}

/** "3:00 PM" in Bengali: the part of the day people say, then the time ("বিকাল ৩:০০"). */
function timeBn(label) {
  const [, hour, minute, meridiem] = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(label) ?? [];
  if (!hour) return bnDigits(label);
  const h24 = (Number(hour) % 12) + (/p/i.test(meridiem) ? 12 : 0);
  const part =
    h24 < 4
      ? "রাত"
      : h24 < 12
        ? "সকাল"
        : h24 < 15
          ? "দুপুর"
          : h24 < 18
            ? "বিকাল"
            : h24 < 20
              ? "সন্ধ্যা"
              : "রাত";
  return `${part} ${bnDigits(`${hour}:${minute}`)}`;
}

/** An appointment's day and time as the API shows them ("2026-10-22", "3:00 PM"), in the language. */
export function whenText(language, date, time) {
  if (language !== "bn") return `${date} at ${time}`;
  const [year, month, day] = date.split("-");
  return `${bnDigits(Number(day))} ${MONTHS_BN[Number(month) - 1]} ${bnDigits(year)}, ${timeBn(time)}`;
}
