"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

// ─── Языки ──────────────────────────────────────────────────────────────────
const TOP_LANGUAGES = [
  "Русский", "Español", "English", "Português", "Italiano",
  "Français", "Deutsch", "日本語", "中文", "العربية",
  "한국어", "Polski", "Română", "Türkçe", "Nederlands",
];

const ALL_LANGUAGES_EXTRA = [
  "Afrikaans", "Albanian", "Amharic", "Armenian", "Azerbaijani",
  "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Burmese",
  "Catalan", "Cebuano", "Croatian", "Czech", "Danish",
  "Estonian", "Filipino", "Finnish", "Galician", "Georgian",
  "Greek", "Gujarati", "Haitian Creole", "Hausa", "Hebrew",
  "Hindi", "Hmong", "Hungarian", "Icelandic", "Igbo",
  "Indonesian", "Irish", "Javanese", "Kannada", "Kazakh",
  "Khmer", "Kurdish", "Kyrgyz", "Lao", "Latin",
  "Latvian", "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy",
  "Malay", "Malayalam", "Maltese", "Maori", "Marathi",
  "Mongolian", "Nepali", "Norwegian", "Pashto", "Persian",
  "Punjabi", "Samoan", "Serbian", "Shona", "Sindhi",
  "Sinhala", "Slovak", "Slovenian", "Somali", "Sotho",
  "Swahili", "Swedish", "Tajik", "Tamil", "Telugu",
  "Thai", "Ukrainian", "Urdu", "Uzbek", "Vietnamese",
  "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu",
];

const LANGUAGE_OPTIONS = [
  ...TOP_LANGUAGES,
  ...ALL_LANGUAGES_EXTRA.sort(),
];

// ─── Страны ──────────────────────────────────────────────────────────────────
const TOP_COUNTRIES = [
  "Россия", "Испания", "США", "Бразилия", "Аргентина",
  "Италия", "Франция", "Германия", "Мексика", "Колумбия",
  "Украина", "Беларусь", "Казахстан", "Польша", "Великобритания",
  "Португалия", "Нидерланды", "Куба", "Доминиканская Республика", "Япония",
];

const ALL_COUNTRIES_EXTRA = [
  "Австралия", "Австрия", "Азербайджан", "Албания", "Алжир",
  "Ангола", "Андорра", "Антигуа и Барбуда", "Армения",
  "Афганистан", "Багамы", "Бангладеш", "Барбадос", "Бахрейн",
  "Белиз", "Бельгия", "Бенин", "Болгария", "Боливия",
  "Босния и Герцеговина", "Ботсвана", "Бруней", "Буркина-Фасо", "Бурунди",
  "Бутан", "Вануату", "Венгрия", "Венесуэла", "Вьетнам",
  "Габон", "Гаити", "Гайана", "Гамбия", "Гана",
  "Гватемала", "Гвинея", "Гвинея-Бисау", "Германия", "Гондурас",
  "Гренада", "Греция", "Грузия", "Дания", "Джибути",
  "Доминика", "Египет", "Замбия", "Зимбабве", "Израиль",
  "Индия", "Индонезия", "Иордания", "Ирак", "Иран",
  "Ирландия", "Исландия", "Йемен", "Камбоджа", "Камерун",
  "Канада", "Катар", "Кения", "Кипр", "Кирибати",
  "Китай", "Коморы", "Конго", "Конго (ДРК)", "Коста-Рика",
  "Кот-д'Ивуар", "Кувейт", "Кыргызстан", "КНДР", "Лаос",
  "Латвия", "Лесото", "Либерия", "Ливан", "Ливия",
  "Литва", "Лихтенштейн", "Люксембург", "Маврикий", "Мавритания",
  "Мадагаскар", "Малави", "Малайзия", "Мальдивы", "Мали",
  "Мальта", "Марокко", "Маршалловы Острова", "Микронезия", "Мозамбик",
  "Молдова", "Монако", "Монголия", "Мьянма", "Намибия",
  "Науру", "Непал", "Нигер", "Нигерия", "Никарагуа",
  "Новая Зеландия", "Норвегия", "ОАЭ", "Оман", "Пакистан",
  "Палау", "Палестина", "Панама", "Папуа — Новая Гвинея", "Парагвай",
  "Перу", "Румыния", "Руанда", "Сальвадор", "Самоа",
  "Сан-Марино", "Саудовская Аравия", "Свазиленд", "Северная Македония", "Сейшелы",
  "Сенегал", "Сент-Китс и Невис", "Сент-Люсия", "Сент-Винсент и Гренадины",
  "Сербия", "Сингапур", "Сирия", "Словакия", "Словения",
  "Соломоновы Острова", "Сомали", "Судан", "Суринам", "Сьерра-Леоне",
  "Таджикистан", "Таиланд", "Танзания", "Тимор-Лесте", "Того",
  "Тонга", "Тринидад и Тобаго", "Тувалу", "Тунис", "Туркменистан",
  "Турция", "Уганда", "Узбекистан", "Уругвай", "Фиджи",
  "Филиппины", "Финляндия", "Центральноафриканская Республика", "Чад", "Черногория",
  "Чехия", "Чили", "Швейцария", "Швеция", "Шри-Ланка",
  "Эквадор", "Экваториальная Гвинея", "Эритрея", "Эсватини", "Эстония",
  "Эфиопия", "Южная Корея", "Южная Осетия", "Южный Судан",
  "Южная Африка", "Ямайка",
];

const COUNTRY_OPTIONS = [
  ...TOP_COUNTRIES,
  ...ALL_COUNTRIES_EXTRA.filter((c) => !TOP_COUNTRIES.includes(c)).sort(),
];

// ─── Типы ────────────────────────────────────────────────────────────────────

interface FieldErrors {
  email?: string;
  name?: string;
  city?: string;
  country?: string;
  language?: string;
  telegram?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  promoCode?: string;
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const [form, setForm] = useState({
    name: "", city: "", country: "", language: "",
    telegram: "", phone: "", email: "",
    password: "", confirmPassword: "", promoCode: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const set = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGlobalError("");
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.errors) setFieldErrors(data.errors);
        else setGlobalError(data.error || "Ошибка регистрации");
        return;
      }

      setSuccess(true);
    } catch {
      setGlobalError("Ошибка соединения. Попробуйте ещё раз.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-green-600 to-green-800 text-white text-2xl mb-6">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Аккаунт создан!</h1>
          <p className="text-gray-400 mb-2">
            Мы отправили письмо с подтверждением на{" "}
            <strong className="text-white">{form.email}</strong>.
          </p>
          <p className="text-gray-400 mb-6">Перейдите по ссылке в письме, чтобы войти.</p>
          <p className="text-gray-500 text-sm mb-6">Не получили? Проверьте папку «Спам».</p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 bg-gradient-to-br from-purple-600 to-purple-800 text-white font-medium rounded-lg hover:from-purple-500 hover:to-purple-700 transition-all"
          >
            Войти
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8 px-4">
      <div className="w-full max-w-lg mx-auto">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 text-white font-bold text-xl mb-4">
            B
          </div>
          <h1 className="text-2xl font-bold text-white">Регистрация</h1>
          <p className="text-gray-400 mt-1 text-sm">Bachata Beat Counter</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4"
        >
          {globalError && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">
              {globalError}
            </div>
          )}

          {/* 1. Язык */}
          <Datalist
            id="language" label="Язык общения" listId="language-list"
            options={LANGUAGE_OPTIONS}
            value={form.language} onChange={set("language")}
            error={fieldErrors.language}
            placeholder="Начните вводить или выберите из списка..."
            hint="Топ-15 языков показаны первыми. Можно ввести любой другой."
          />

          {/* 2. Страна */}
          <Datalist
            id="country" label="Страна" listId="country-list"
            options={COUNTRY_OPTIONS}
            value={form.country} onChange={set("country")}
            error={fieldErrors.country}
            placeholder="Начните вводить или выберите из списка..."
            hint="Топ-20 стран показаны первыми. Можно ввести любую другую."
          />

          {/* 3. Город */}
          <Field id="city" label="Город" placeholder="Ваш город"
            value={form.city} onChange={set("city")} error={fieldErrors.city}
            autoComplete="address-level2"
          />

          {/* 4. Имя */}
          <Field id="name" label="Имя" placeholder="Как вас зовут"
            value={form.name} onChange={set("name")} error={fieldErrors.name}
            autoComplete="name"
          />

          {/* 5. Telegram — необязательный */}
          <div>
            <label htmlFor="telegram" className="block text-sm font-medium text-gray-300 mb-1">
              Telegram{" "}
              <span className="text-gray-500 font-normal">(необязательно)</span>
            </label>
            <input
              id="telegram"
              type="text"
              value={form.telegram}
              onChange={set("telegram")}
              placeholder="@username"
              className={`w-full px-3 py-2.5 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors ${
                fieldErrors.telegram ? "border-red-500" : "border-gray-600"
              }`}
            />
            {fieldErrors.telegram ? (
              <p className="mt-1 text-xs text-red-400">{fieldErrors.telegram}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">5–32 символа: буквы, цифры, _</p>
            )}
          </div>

          {/* 6. Телефон */}
          <Field id="phone" label="Телефон" placeholder="+7XXXXXXXXXX" type="tel"
            value={form.phone} onChange={set("phone")} error={fieldErrors.phone}
            autoComplete="tel" hint="Международный формат: +7 912 345 67 89"
          />

          {/* 7. Email */}
          <Field id="email" label="Email" placeholder="email@example.com" type="email"
            value={form.email} onChange={set("email")} error={fieldErrors.email}
            autoComplete="email"
          />

          {/* 8. Пароль */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              Пароль
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={set("password")}
                placeholder="Минимум 8 символов + цифра/спецсимвол"
                autoComplete="new-password"
                className={`w-full px-3 py-2.5 pr-10 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors ${
                  fieldErrors.password ? "border-red-500" : "border-gray-600"
                }`}
              />
              <button type="button" tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors text-base leading-none"
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
            {fieldErrors.password ? (
              <p className="mt-1 text-xs text-red-400">{fieldErrors.password}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                Минимум 8 символов, хотя бы одна цифра или спецсимвол
              </p>
            )}
          </div>

          {/* 9. Пароль ещё раз */}
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-1">
              Пароль ещё раз
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirm ? "text" : "password"}
                value={form.confirmPassword}
                onChange={set("confirmPassword")}
                placeholder="Повторите пароль"
                autoComplete="new-password"
                className={`w-full px-3 py-2.5 pr-10 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors ${
                  fieldErrors.confirmPassword ? "border-red-500" : "border-gray-600"
                }`}
              />
              <button type="button" tabIndex={-1}
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors text-base leading-none"
              >
                {showConfirm ? "🙈" : "👁"}
              </button>
            </div>
            {fieldErrors.confirmPassword && (
              <p className="mt-1 text-xs text-red-400">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          {/* 10. Промокод — необязательный */}
          <div>
            <label htmlFor="promoCode" className="block text-sm font-medium text-gray-300 mb-1">
              Промокод{" "}
              <span className="text-gray-500 font-normal">(не обязателен)</span>
            </label>
            <input
              id="promoCode"
              type="text"
              value={form.promoCode}
              onChange={set("promoCode")}
              placeholder="Если у вас есть промокод"
              className={`w-full px-3 py-2.5 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors ${
                fieldErrors.promoCode ? "border-red-500" : "border-gray-600"
              }`}
            />
            {fieldErrors.promoCode && (
              <p className="mt-1 text-xs text-red-400">{fieldErrors.promoCode}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">Промокод даёт роль модератора</p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-gradient-to-br from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {isSubmitting ? "Регистрация..." : "Зарегистрироваться"}
          </button>
        </form>

        <div className="text-center mt-4">
          <p className="text-sm text-gray-400">
            Уже есть аккаунт?{" "}
            <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Вспомогательные компоненты ──────────────────────────────────────────────

function Datalist({
  id, label, listId, options, value, onChange, error, hint, placeholder,
}: {
  id: string;
  label: string;
  listId: string;
  options: string[];
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-300 mb-1">
        {label}
      </label>
      <input
        id={id}
        list={listId}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="off"
        className={`w-full px-3 py-2.5 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors ${
          error ? "border-red-500" : "border-gray-600"
        }`}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {error ? (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

function Field({
  id, label, value, onChange, error, hint,
  type = "text", placeholder, autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-300 mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`w-full px-3 py-2.5 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors ${
          error ? "border-red-500" : "border-gray-600"
        }`}
      />
      {error ? (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}
