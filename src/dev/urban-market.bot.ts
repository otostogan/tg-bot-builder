import {
    IBotBuilderContext,
    IBotBuilderOptions,
    IBotPage,
    IBotPageMiddlewareConfig,
    IBotSessionState,
} from '../';
import * as yup from 'yup';

type TContactValue = {
    phone_number?: string;
    first_name?: string;
    last_name?: string;
};

interface IUrbanMarketProfile {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
}

interface IUrbanMarketRegistrationState {
    completed?: boolean;
    registeredAt?: string;
}

interface IUrbanMarketSession extends IBotSessionState {
    profile?: IUrbanMarketProfile;
    registration?: IUrbanMarketRegistrationState;
    cart?: string[];
    lastOrderNumber?: string;
}

interface ICategory {
    id: string;
    title: string;
    description: string;
    mood?: string;
}

interface IProduct {
    id: string;
    categoryId: string;
    title: string;
    description: string;
    price: number;
    tastingNotes: string[];
}

class UrbanMarketCatalogService {
    private readonly categories: ICategory[] = [
        {
            id: 'tea',
            title: 'Ароматные чаи',
            description:
                'Подборка авторских улунов и травяных смесей, которые прогреют и наполнят ароматами городской оранжереи.',
            mood: '🌿',
        },
        {
            id: 'dessert',
            title: 'Десерты без спешки',
            description:
                'Домашние тарты и десерты, которые мы печём малыми партиями к каждому вечеру дегустаций.',
            mood: '🍰',
        },
    ];

    private readonly products: IProduct[] = [
        {
            id: 'tea-mango-oolong',
            categoryId: 'tea',
            title: 'Манговый улун «Летний балкон»',
            description:
                'Лёгкий ферментированный улун с кусочками сушёного манго и лепестками календулы.',
            price: 790,
            tastingNotes: [
                'сладость манго',
                'флёр цитрусовой корки',
                'мягкое сливочное послевкусие',
            ],
        },
        {
            id: 'tea-bergamot-green',
            categoryId: 'tea',
            title: 'Зелёный чай с бергамотом «Лампа Эдисона»',
            description:
                'Бодрящий купаж сенчи и жёлтого чая с эфирными маслами бергамота и василька.',
            price: 640,
            tastingNotes: [
                'пряный цитрус',
                'лёгкая терпкость',
                'долгий медовый шлейф',
            ],
        },
        {
            id: 'dessert-lavender-tart',
            categoryId: 'dessert',
            title: 'Лавандовый тарт с голубикой',
            description:
                'Рассыпчатое тесто, заварной крем с инфузией лаванды и свежая голубика.',
            price: 420,
            tastingNotes: ['лаванда', 'сливки', 'ягодная свежесть'],
        },
        {
            id: 'dessert-salted-caramel',
            categoryId: 'dessert',
            title: 'Мини-чизкейк с солёной карамелью',
            description:
                'Классический чизкейк Нью-Йорк в мини-формате с домашней карамелью.',
            price: 360,
            tastingNotes: [
                'сливочный сыр',
                'солёная карамель',
                'хруст печенья',
            ],
        },
    ];

    public listCategories(): ICategory[] {
        return [...this.categories];
    }

    public getCategory(categoryId: string): ICategory | undefined {
        return this.categories.find((category) => category.id === categoryId);
    }

    public listProductsByCategory(categoryId: string): IProduct[] {
        return this.products.filter(
            (product) => product.categoryId === categoryId,
        );
    }

    public getProduct(productId: string): IProduct | undefined {
        return this.products.find((product) => product.id === productId);
    }

    public formatProductCard(product: IProduct): string {
        const notes = product.tastingNotes
            .map((note) => `• ${note}`)
            .join('\n');

        return [
            `*${product.title}* — ${product.price} ₽`,
            '',
            product.description,
            '',
            'Ноты дегустации:',
            notes,
        ]
            .filter(Boolean)
            .join('\n');
    }
}

const BUTTONS = {
    openCatalog: '📦 Перейти в каталог',
    editProfile: '✏️ Изменить данные',
    mainMenu: '⬅️ Главное меню',
    backToCategories: '⬅️ Категории',
    backToCategory: '⬅️ Назад к категории',
    openCart: '🧺 Открыть корзину',
    addToCart: '🛒 Добавить в корзину',
    viewProfile: '👤 Профиль',
    viewCatalog: '🏬 Каталог',
    viewCart: '🧺 Корзина',
    support: '🛟 Поддержка',
    reset: '🔄 Начать регистрацию заново',
    confirmReset: 'Да, стереть данные',
    cancelReset: 'Нет, оставить всё как есть',
    checkout: '✅ Оформить заказ',
    clearCart: '🧹 Очистить корзину',
};

const catalogService = new UrbanMarketCatalogService();

const ensureSession = (context: IBotBuilderContext): IUrbanMarketSession => {
    if (!context.session) {
        context.session = {};
    }

    return context.session as IUrbanMarketSession;
};

const getProfile = (context: IBotBuilderContext): IUrbanMarketProfile => {
    const session = ensureSession(context);
    session.profile = session.profile ?? {};
    return session.profile;
};

const isRegistrationCompleted = (session?: IUrbanMarketSession): boolean =>
    Boolean(session?.registration?.completed);

const formatProfileSummary = (profile: IUrbanMarketProfile): string => {
    const rows = [
        `Имя: ${profile.firstName ?? '—'}`,
        `Фамилия: ${profile.lastName ?? '—'}`,
        `Телефон: ${profile.phone ?? '—'}`,
        `Почта: ${profile.email ?? '—'}`,
        `Адрес доставки: ${profile.address ?? '—'}`,
    ];

    return rows.join('\n');
};

const normalizePhoneValue = (value: unknown): string | undefined => {
    if (!value) {
        return undefined;
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (typeof value === 'object' && value !== null) {
        const contact = value as TContactValue;
        if (typeof contact.phone_number === 'string') {
            return contact.phone_number.trim();
        }
    }

    return undefined;
};

const requireRegistrationMiddleware: IBotPageMiddlewareConfig = {
    name: 'require-registration',
    priority: 100,
    handler: (context) => {
        const session = context.session as IUrbanMarketSession | undefined;
        if (!isRegistrationCompleted(session)) {
            return {
                allow: false,
                message:
                    'Мы ещё не познакомились. Ответьте, пожалуйста, на вопросы регистрации, чтобы открыть каталог.',
            };
        }

        return { allow: true };
    },
};

const registrationPages: IBotPage[] = [
    {
        id: 'first-name',
        content:
            '👋 Добро пожаловать в городской маркет Urban Greenhouse!\n\nКак вас зовут? Напишите ваше имя, чтобы мы могли обращаться по нему.',
        yup: yup
            .string()
            .trim()
            .min(2, 'Имя должно содержать минимум 2 символа.')
            .max(30, 'Имя не должно быть длиннее 30 символов.')
            .required('Пожалуйста, укажите имя.'),
        onValid: (context) => {
            const profile = getProfile(context);
            const value = String(context.session?.['first-name'] ?? '').trim();
            profile.firstName = value;
        },
        next: () => 'last-name',
    },
    {
        id: 'last-name',
        content:
            'Прекрасно! А теперь укажите фамилию — курьеры будут обращаться именно так.',
        yup: yup
            .string()
            .trim()
            .min(2, 'Фамилия должна содержать минимум 2 символа.')
            .max(40, 'Фамилия не должна быть длиннее 40 символов.')
            .required('Пожалуйста, укажите фамилию.'),
        onValid: (context) => {
            const profile = getProfile(context);
            const value = String(context.session?.['last-name'] ?? '').trim();
            profile.lastName = value;
        },
        next: () => 'email',
    },
    {
        id: 'email',
        content:
            'Укажите электронную почту, чтобы мы могли отправлять электронные чеки и подборки новинок.',
        yup: yup
            .string()
            .trim()
            .email('Похоже, адрес электронной почты указан с ошибкой.')
            .required('Пожалуйста, напишите электронную почту.'),
        onValid: (context) => {
            const profile = getProfile(context);
            const value = String(context.session?.email ?? '').trim();
            profile.email = value;
        },
        next: () => 'phone',
    },
    {
        id: 'phone',
        content:
            '☎️ Оставьте контактный номер. Можно отправить его текстом или нажмите кнопку «Поделиться контактом».',
        validate: (value) => {
            if (typeof value === 'string') {
                return /^\+?\d[\d\s\-()]{7,}$/.test(value.trim());
            }

            if (value && typeof value === 'object' && 'phone_number' in value) {
                return true;
            }

            return false;
        },
        onValid: (context) => {
            const profile = getProfile(context);
            const rawValue = context.session?.phone;
            const normalized = normalizePhoneValue(rawValue);
            profile.phone = normalized;
        },
        next: () => 'address',
    },
    {
        id: 'address',
        content:
            '🏙️ Куда доставлять покупки? Напишите адрес с городом, улицей и домом, чтобы мы могли построить маршрут.',
        yup: yup
            .string()
            .trim()
            .min(
                10,
                'Опишите адрес чуть подробнее, чтобы курьер точно нашёл вас.',
            )
            .required('Пожалуйста, укажите адрес доставки.'),
        onValid: (context) => {
            const profile = getProfile(context);
            const value = String(context.session?.address ?? '').trim();
            profile.address = value;
        },
        next: () => 'registration-summary',
    },
    {
        id: 'registration-summary',
        content: (context) => {
            const session = ensureSession(context);
            const profile = getProfile(context);
            const summary = formatProfileSummary(profile);
            const greeting = profile.firstName
                ? `Спасибо, ${profile.firstName}!`
                : 'Спасибо за ответы!';

            const registeredAt = session.registration?.registeredAt
                ? new Date(session.registration.registeredAt).toLocaleString(
                      'ru-RU',
                      {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: 'long',
                      },
                  )
                : null;

            const history = registeredAt
                ? `\n\nПоследняя анкета сохранена ${registeredAt}.`
                : '';

            return {
                text: [
                    '✅ Регистрация завершена!',
                    greeting,
                    '',
                    summary,
                    history,
                    '',
                    'Выберите, что сделать дальше.',
                ]
                    .filter(Boolean)
                    .join('\n'),
                options: { parse_mode: 'Markdown' },
            };
        },
        validate: (value) =>
            typeof value === 'string' &&
            [BUTTONS.openCatalog, BUTTONS.editProfile].includes(value.trim()),
        onValid: (context) => {
            const session = ensureSession(context);
            const answer = String(
                context.session?.['registration-summary'] ?? '',
            ).trim();

            if (answer === BUTTONS.openCatalog) {
                session.registration = {
                    completed: true,
                    registeredAt: new Date().toISOString(),
                };
            }

            if (answer === BUTTONS.editProfile) {
                session.registration = { completed: false };
                session.cart = [];

                delete session['first-name'];
                delete session['last-name'];
                delete session.email;
                delete session.phone;
                delete session.address;

                if (session.profile) {
                    session.profile = {};
                }
            }
        },
        next: (context) => {
            const answer = String(
                context.session?.['registration-summary'] ?? '',
            ).trim();
            return answer === BUTTONS.editProfile ? 'first-name' : 'main-menu';
        },
    },
];

const catalogPages: IBotPage[] = [
    {
        id: 'main-menu',
        content: (context) => {
            const session = ensureSession(context);
            const profile = session.profile ?? {};
            const name = profile.firstName ?? 'друг';
            const cartSize = session.cart?.length ?? 0;
            const cartLine =
                cartSize > 0
                    ? `\n🧺 В корзине ${cartSize} позици${cartSize === 1 ? 'я' : 'и'}.`
                    : '';

            return {
                text: [
                    `🌱 Снова рады вас видеть, ${name}!`,
                    'Выберите раздел, с которого хотите начать.',
                    cartLine,
                ]
                    .filter(Boolean)
                    .join('\n\n'),
            };
        },
        validate: (value) =>
            typeof value === 'string' &&
            [
                BUTTONS.viewCatalog,
                BUTTONS.viewProfile,
                BUTTONS.viewCart,
                BUTTONS.support,
                BUTTONS.reset,
            ].includes(value.trim()),
        onValid: (context) => {
            const session = ensureSession(context);
            const answer = String(context.session?.['main-menu'] ?? '').trim();

            if (answer === BUTTONS.reset) {
                session.lastOrderNumber = undefined;
            }
        },
        next: (context) => {
            const answer = String(context.session?.['main-menu'] ?? '').trim();
            switch (answer) {
                case BUTTONS.viewCatalog:
                    return 'catalog-categories';
                case BUTTONS.viewProfile:
                    return 'profile-overview';
                case BUTTONS.viewCart:
                    return 'cart-overview';
                case BUTTONS.support:
                    return 'support';
                case BUTTONS.reset:
                    return 'reset-confirm';
                default:
                    return 'main-menu';
            }
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'catalog-categories',
        content: (context) => {
            const categories = catalogService.listCategories();
            const lines = categories.map(
                (category) =>
                    `${category.mood ?? '•'} *${category.title}* — ${category.description}`,
            );

            return {
                text: [
                    '🏬 Категории каталога Urban Greenhouse:',
                    '',
                    ...lines,
                    '',
                    'Выберите категорию, чтобы посмотреть позиции.',
                ].join('\n'),
                options: { parse_mode: 'Markdown' },
            };
        },
        validate: (value) => {
            if (typeof value !== 'string') {
                return false;
            }

            const normalized = value.trim();
            if (normalized === BUTTONS.mainMenu) {
                return true;
            }

            const categories = catalogService.listCategories();
            return categories.some((category) => category.title === normalized);
        },
        next: (context) => {
            const answer = String(
                context.session?.['catalog-categories'] ?? '',
            ).trim();
            if (answer === BUTTONS.mainMenu) {
                return 'main-menu';
            }

            const category = catalogService
                .listCategories()
                .find((item) => item.title === answer);

            if (!category) {
                return 'catalog-categories';
            }

            return `catalog-${category.id}`;
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'catalog-tea',
        content: () => {
            const products = catalogService.listProductsByCategory('tea');
            const lines = products.map(
                (product) => `• ${product.title} — ${product.price} ₽`,
            );

            return {
                text: [
                    '🌿 Авторские чаи:',
                    ...lines,
                    '',
                    'Выберите напиток, чтобы узнать подробности.',
                ].join('\n'),
            };
        },
        validate: (value) => {
            if (typeof value !== 'string') {
                return false;
            }

            const normalized = value.trim();
            if (
                [BUTTONS.mainMenu, BUTTONS.backToCategories].includes(
                    normalized,
                )
            ) {
                return true;
            }

            const products = catalogService.listProductsByCategory('tea');
            return products.some((product) => product.title === normalized);
        },
        next: (context) => {
            const answer = String(
                context.session?.['catalog-tea'] ?? '',
            ).trim();
            if (answer === BUTTONS.mainMenu) {
                return 'main-menu';
            }

            if (answer === BUTTONS.backToCategories) {
                return 'catalog-categories';
            }

            const product = catalogService
                .listProductsByCategory('tea')
                .find((item) => item.title === answer);

            if (!product) {
                return 'catalog-tea';
            }

            return `product-${product.id}`;
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'catalog-dessert',
        content: () => {
            const products = catalogService.listProductsByCategory('dessert');
            const lines = products.map(
                (product) => `• ${product.title} — ${product.price} ₽`,
            );

            return {
                text: [
                    '🍰 Десерты дня:',
                    ...lines,
                    '',
                    'Выберите десерт, чтобы узнать подробности.',
                ].join('\n'),
            };
        },
        validate: (value) => {
            if (typeof value !== 'string') {
                return false;
            }

            const normalized = value.trim();
            if (
                [BUTTONS.mainMenu, BUTTONS.backToCategories].includes(
                    normalized,
                )
            ) {
                return true;
            }

            const products = catalogService.listProductsByCategory('dessert');
            return products.some((product) => product.title === normalized);
        },
        next: (context) => {
            const answer = String(
                context.session?.['catalog-dessert'] ?? '',
            ).trim();
            if (answer === BUTTONS.mainMenu) {
                return 'main-menu';
            }

            if (answer === BUTTONS.backToCategories) {
                return 'catalog-categories';
            }

            const product = catalogService
                .listProductsByCategory('dessert')
                .find((item) => item.title === answer);

            if (!product) {
                return 'catalog-dessert';
            }

            return `product-${product.id}`;
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'cart-overview',
        content: (context) => {
            const session = ensureSession(context);
            const cart = session.cart ?? [];

            if (cart.length === 0) {
                return {
                    text: '🧺 Ваша корзина пуста. Добавьте что-нибудь из каталога, и мы сразу подготовим заказ.',
                };
            }

            const items = cart
                .map((productId, index) => {
                    const product = catalogService.getProduct(productId);
                    if (!product) {
                        return null;
                    }

                    return `${index + 1}. ${product.title} — ${product.price} ₽`;
                })
                .filter(Boolean) as string[];

            const total = cart.reduce((sum, productId) => {
                const product = catalogService.getProduct(productId);
                return product ? sum + product.price : sum;
            }, 0);

            return {
                text: [
                    '🧺 В корзине:',
                    ...items,
                    '',
                    `Итого к оплате: ${total} ₽`,
                    '',
                    'Можно оформить заказ или вернуться к покупкам.',
                ].join('\n'),
            };
        },
        validate: (value) =>
            typeof value === 'string' &&
            [BUTTONS.mainMenu, BUTTONS.clearCart, BUTTONS.checkout].includes(
                value.trim(),
            ),
        onValid: (context) => {
            const session = ensureSession(context);
            const answer = String(
                context.session?.['cart-overview'] ?? '',
            ).trim();

            if (answer === BUTTONS.clearCart) {
                session.cart = [];
            }

            if (
                answer === BUTTONS.checkout &&
                (!session.cart || session.cart.length === 0)
            ) {
                context.bot.sendMessage(
                    context.chatId,
                    'Корзина пуста. Добавьте хотя бы один товар, чтобы оформить заказ.',
                );
            }
        },
        next: (context) => {
            const answer = String(
                context.session?.['cart-overview'] ?? '',
            ).trim();

            if (answer === BUTTONS.clearCart) {
                return 'cart-overview';
            }

            if (answer === BUTTONS.checkout) {
                const session = ensureSession(context);
                if (!session.cart || session.cart.length === 0) {
                    return 'cart-overview';
                }

                const orderNumber = `UG-${Date.now().toString().slice(-6)}`;
                session.lastOrderNumber = orderNumber;
                session.cart = [];
                return 'order-confirmation';
            }

            return 'main-menu';
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'order-confirmation',
        content: (context) => {
            const session = ensureSession(context);
            const profile = session.profile ?? {};
            const orderNumber =
                session.lastOrderNumber ??
                `UG-${Date.now().toString().slice(-6)}`;

            return {
                text: [
                    '🎉 Заказ оформлен!',
                    `Номер заказа: *${orderNumber}*`,
                    '',
                    `Мы позвоним по номеру ${profile.phone ?? '—'} и уточним время доставки.`,
                    `Отправим курьера по адресу: ${profile.address ?? '—'}.`,
                    '',
                    'Хотите продолжить покупки или вернуться в главное меню?',
                ].join('\n'),
                options: { parse_mode: 'Markdown' },
            };
        },
        validate: (value) =>
            typeof value === 'string' &&
            [BUTTONS.mainMenu, BUTTONS.viewCatalog].includes(value.trim()),
        next: (context) => {
            const answer = String(
                context.session?.['order-confirmation'] ?? '',
            ).trim();
            if (answer === BUTTONS.viewCatalog) {
                return 'catalog-categories';
            }

            return 'main-menu';
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'profile-overview',
        content: (context) => {
            const session = ensureSession(context);
            const profile = session.profile ?? {};
            const summary = formatProfileSummary(profile);

            return {
                text: [
                    '👤 Ваш профиль Urban Greenhouse:',
                    '',
                    summary,
                    '',
                    'Можно обновить адрес или начать регистрацию заново.',
                ].join('\n'),
            };
        },
        validate: (value) =>
            typeof value === 'string' &&
            [BUTTONS.mainMenu, BUTTONS.editProfile, BUTTONS.reset].includes(
                value.trim(),
            ),
        next: (context) => {
            const answer = String(
                context.session?.['profile-overview'] ?? '',
            ).trim();
            if (answer === BUTTONS.editProfile) {
                return 'address-update';
            }

            if (answer === BUTTONS.reset) {
                return 'reset-confirm';
            }

            return 'main-menu';
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'address-update',
        content:
            '✏️ Напишите новый адрес доставки. Мы сразу обновим его в профиле и в ближайших заказах.',
        yup: yup
            .string()
            .trim()
            .min(
                10,
                'Опишите адрес чуть подробнее, чтобы курьер точно нашёл вас.',
            )
            .required('Пожалуйста, укажите новый адрес.'),
        onValid: (context) => {
            const session = ensureSession(context);
            const value = String(
                context.session?.['address-update'] ?? '',
            ).trim();
            const profile = session.profile ?? {};
            profile.address = value;
            session.profile = profile;
            session.address = value;
        },
        next: () => 'profile-overview',
        middlewares: ['require-registration'],
    },
    {
        id: 'support',
        content: (context) => {
            const session = ensureSession(context);
            const profile = session.profile ?? {};

            return {
                text: [
                    '🛟 Служба поддержки Urban Greenhouse',
                    '',
                    'Мы на связи ежедневно с 10:00 до 22:00.',
                    'Напишите нам прямо в чате или позвоните по номеру +7 (999) 777-45-45.',
                    '',
                    profile.email
                        ? `Также можем ответить на ${profile.email} — просто отправьте письмо.`
                        : 'Оставьте почту в профиле, чтобы мы могли писать вам на e-mail.',
                    '',
                    'Вернуться в главное меню?',
                ]
                    .filter(Boolean)
                    .join('\n'),
            };
        },
        validate: (value) =>
            typeof value === 'string' &&
            [BUTTONS.mainMenu, BUTTONS.viewCatalog].includes(value.trim()),
        next: (context) => {
            const answer = String(context.session?.support ?? '').trim();
            if (answer === BUTTONS.viewCatalog) {
                return 'catalog-categories';
            }

            return 'main-menu';
        },
        middlewares: ['require-registration'],
    },
    {
        id: 'reset-confirm',
        content:
            '⚠️ Вы уверены, что хотите стереть профиль и пройти регистрацию заново? Это удалит историю заказов и корзину.',
        validate: (value) =>
            typeof value === 'string' &&
            [BUTTONS.confirmReset, BUTTONS.cancelReset].includes(value.trim()),
        onValid: (context) => {
            const session = ensureSession(context);
            const answer = String(
                context.session?.['reset-confirm'] ?? '',
            ).trim();

            if (answer === BUTTONS.confirmReset) {
                session.profile = {};
                session.registration = { completed: false };
                session.cart = [];

                delete session['first-name'];
                delete session['last-name'];
                delete session.email;
                delete session.phone;
                delete session.address;
                delete session['registration-summary'];
                delete session['main-menu'];
            }
        },
        next: (context) => {
            const answer = String(
                context.session?.['reset-confirm'] ?? '',
            ).trim();
            if (answer === BUTTONS.confirmReset) {
                return 'first-name';
            }

            return 'main-menu';
        },
        middlewares: ['require-registration'],
    },
];

const buildProductPage = (productId: string): IBotPage => ({
    id: `product-${productId}`,
    content: () => {
        const product = catalogService.getProduct(productId);
        if (!product) {
            return {
                text: 'Не удалось найти описание продукта. Вернитесь в каталог и попробуйте снова.',
            };
        }

        return {
            text: catalogService.formatProductCard(product),
            options: { parse_mode: 'Markdown' },
        };
    },
    validate: (value) =>
        typeof value === 'string' &&
        [
            BUTTONS.addToCart,
            BUTTONS.backToCategory,
            BUTTONS.backToCategories,
            BUTTONS.mainMenu,
            BUTTONS.openCart,
        ].includes(value.trim()),
    onValid: (context) => {
        const session = ensureSession(context);
        const answer = String(
            context.session?.[`product-${productId}`] ?? '',
        ).trim();

        if (answer === BUTTONS.addToCart) {
            session.cart = session.cart ?? [];
            session.cart.push(productId);
            context.bot.sendMessage(
                context.chatId,
                'Добавили в корзину! Можно продолжить выбирать позиции или оформить заказ.',
            );
        }
    },
    next: (context) => {
        const answer = String(
            context.session?.[`product-${productId}`] ?? '',
        ).trim();
        if (answer === BUTTONS.addToCart) {
            return 'cart-overview';
        }

        if (answer === BUTTONS.backToCategory) {
            const product = catalogService.getProduct(productId);
            return product
                ? `catalog-${product.categoryId}`
                : 'catalog-categories';
        }

        if (answer === BUTTONS.backToCategories) {
            return 'catalog-categories';
        }

        if (answer === BUTTONS.openCart) {
            return 'cart-overview';
        }

        return 'main-menu';
    },
    middlewares: ['require-registration'],
});

const productPages: IBotPage[] = catalogService
    .listCategories()
    .flatMap((category) =>
        catalogService
            .listProductsByCategory(category.id)
            .map((product) => buildProductPage(product.id)),
    );

const keyboards = [
    {
        id: 'phone',
        resolve: () => ({
            keyboard: [
                [{ text: '📱 Поделиться контактом', request_contact: true }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
        }),
    },
    {
        id: 'registration-summary',
        resolve: () => ({
            keyboard: [
                [{ text: BUTTONS.openCatalog }],
                [{ text: BUTTONS.editProfile }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
        }),
    },
    {
        id: 'catalog-categories',
        resolve: () => {
            const categories = catalogService.listCategories();
            const buttons = categories.map((category) => [
                { text: category.title },
            ]);
            buttons.push([{ text: BUTTONS.mainMenu }]);

            return {
                keyboard: buttons,
                resize_keyboard: true,
            };
        },
    },
    {
        id: 'catalog-tea',
        resolve: () => {
            const products = catalogService.listProductsByCategory('tea');
            const buttons = products.map((product) => [
                { text: product.title },
            ]);
            buttons.push([{ text: BUTTONS.backToCategories }]);
            buttons.push([{ text: BUTTONS.mainMenu }]);

            return {
                keyboard: buttons,
                resize_keyboard: true,
            };
        },
    },
    {
        id: 'catalog-dessert',
        resolve: () => {
            const products = catalogService.listProductsByCategory('dessert');
            const buttons = products.map((product) => [
                { text: product.title },
            ]);
            buttons.push([{ text: BUTTONS.backToCategories }]);
            buttons.push([{ text: BUTTONS.mainMenu }]);

            return {
                keyboard: buttons,
                resize_keyboard: true,
            };
        },
    },
    ...catalogService.listCategories().flatMap((category) =>
        catalogService.listProductsByCategory(category.id).map((product) => ({
            id: `product-${product.id}`,
            resolve: () => ({
                keyboard: [
                    [{ text: BUTTONS.addToCart }],
                    [
                        { text: BUTTONS.backToCategory },
                        { text: BUTTONS.backToCategories },
                    ],
                    [{ text: BUTTONS.openCart }, { text: BUTTONS.mainMenu }],
                ],
                resize_keyboard: true,
            }),
        })),
    ),
    {
        id: 'cart-overview',
        resolve: (context: IBotBuilderContext) => {
            const session = ensureSession(context);
            const cartIsEmpty = !session.cart || session.cart.length === 0;
            const keyboard = [[{ text: BUTTONS.mainMenu }]];

            if (!cartIsEmpty) {
                keyboard.unshift([{ text: BUTTONS.checkout }]);
                keyboard.splice(1, 0, [{ text: BUTTONS.clearCart }]);
            }

            return {
                keyboard,
                resize_keyboard: true,
            };
        },
    },
    {
        id: 'order-confirmation',
        resolve: () => ({
            keyboard: [
                [{ text: BUTTONS.viewCatalog }],
                [{ text: BUTTONS.mainMenu }],
            ],
            resize_keyboard: true,
        }),
    },
    {
        id: 'profile-overview',
        resolve: () => ({
            keyboard: [
                [{ text: BUTTONS.editProfile }],
                [{ text: BUTTONS.mainMenu }, { text: BUTTONS.reset }],
            ],
            resize_keyboard: true,
        }),
    },
    {
        id: 'address-update',
        resolve: () => ({
            keyboard: [[{ text: BUTTONS.mainMenu }]],
            resize_keyboard: true,
            one_time_keyboard: true,
        }),
    },
    {
        id: 'support',
        resolve: () => ({
            keyboard: [
                [{ text: BUTTONS.viewCatalog }],
                [{ text: BUTTONS.mainMenu }],
            ],
            resize_keyboard: true,
        }),
    },
    {
        id: 'reset-confirm',
        resolve: () => ({
            keyboard: [
                [{ text: BUTTONS.confirmReset }],
                [{ text: BUTTONS.cancelReset }],
            ],
            resize_keyboard: true,
        }),
    },
    {
        id: 'main-navigation',
        persistent: true,
        resolve: (context: IBotBuilderContext) => {
            const session = context.session as IUrbanMarketSession | undefined;
            if (!isRegistrationCompleted(session)) {
                return undefined;
            }

            return {
                keyboard: [
                    [{ text: BUTTONS.viewCatalog }, { text: BUTTONS.viewCart }],
                    [{ text: BUTTONS.viewProfile }, { text: BUTTONS.support }],
                    [{ text: BUTTONS.reset }],
                ],
                resize_keyboard: true,
            };
        },
    },
];

export const createUrbanMarketBot = (
    token: string,
    overrides: Partial<IBotBuilderOptions> = {},
): IBotBuilderOptions => ({
    TG_BOT_TOKEN: token,
    id: overrides.id ?? 'urban-market-dev',
    slug: overrides.slug ?? 'urban-market-dev',
    initialPageId: overrides.initialPageId ?? 'first-name',
    services: {
        catalog: catalogService,
        ...(overrides.services ?? {}),
    },
    pageMiddlewares: [requireRegistrationMiddleware],
    pages: [...registrationPages, ...catalogPages, ...productPages],
    keyboards,
    ...overrides,
});

export type { IUrbanMarketSession, UrbanMarketCatalogService };
