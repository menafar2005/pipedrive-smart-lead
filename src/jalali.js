function div(a, b) {
	return ~~(a / b);
}

function gregorianToJalali(gy, gm, gd) {
	const gDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	const jDaysInMonth = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

	gy = Number(gy) - 1600;
	gm = Number(gm) - 1;
	gd = Number(gd) - 1;

	let gDayNo =
		365 * gy +
		div(gy + 3, 4) -
		div(gy + 99, 100) +
		div(gy + 399, 400);

	for (let i = 0; i < gm; ++i) {
		gDayNo += gDaysInMonth[i];
	}

	if (
		gm > 1 &&
		((gy + 1600) % 4 === 0 && (gy + 1600) % 100 !== 0 || (gy + 1600) % 400 === 0)
	) {
		gDayNo++;
	}

	gDayNo += gd;

	let jDayNo = gDayNo - 79;

	const jNp = div(jDayNo, 12053);
	jDayNo %= 12053;

	let jy = 979 + 33 * jNp + 4 * div(jDayNo, 1461);

	jDayNo %= 1461;

	if (jDayNo >= 366) {
		jy += div(jDayNo - 1, 365);
		jDayNo = (jDayNo - 1) % 365;
	}

	let jm = 0;

	for (; jm < 11 && jDayNo >= jDaysInMonth[jm]; ++jm) {
		jDayNo -= jDaysInMonth[jm];
	}

	const jd = jDayNo + 1;

	return {
		jy,
		jm: jm + 1,
		jd
	};
}

function pad2(value) {
	return String(value).padStart(2, "0");
}

function getTehranDateParts(date) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Tehran",
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).formatToParts(date);

	const map = {};

	for (const part of parts) {
		if (part.type !== "literal") {
			map[part.type] = part.value;
		}
	}

	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day)
	};
}

export function toShamsiDateString(inputDate) {
	const date = inputDate instanceof Date ? inputDate : new Date(inputDate);

	if (Number.isNaN(date.getTime())) {
		throw new Error("Invalid date for Shamsi conversion.");
	}

	const tehran = getTehranDateParts(date);

	const jalali = gregorianToJalali(
		tehran.year,
		tehran.month,
		tehran.day
	);

	return `${jalali.jy}/${pad2(jalali.jm)}/${pad2(jalali.jd)}`;
}

export function parsePipedriveDateTime(value) {
	if (!value) {
		return new Date();
	}

	if (value instanceof Date) {
		return value;
	}

	const text = String(value).trim();

	if (text.includes("T")) {
		return new Date(text);
	}

	return new Date(text.replace(" ", "T") + "Z");
}