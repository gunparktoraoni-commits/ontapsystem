import {
  LegalBullet,
  LegalDocumentLayout,
  LegalTableRow,
  LegalTocLink,
} from "./LegalDocumentPrimitives";

export function CookiePolicyContent() {
  return (
    <LegalDocumentLayout
      title="Cookie Policy"
      toc={
        <>
          <LegalTocLink href="#1" number="1">
            What Are Cookies?
          </LegalTocLink>
          <LegalTocLink href="#2" number="2">
            Why We Use Cookies
          </LegalTocLink>
          <div className="w-full flex flex-col items-start">
            <LegalTocLink href="#3" number="3">
              Types of Cookies We Use
            </LegalTocLink>
            <div className="w-full pl-1 flex flex-col items-start">
              <LegalTocLink href="#3.1" number="3.1" nested>
                Strictly Necessary Cookies
              </LegalTocLink>
              <LegalTocLink href="#3.2" number="3.2" nested>
                Preference Cookies (Functional)
              </LegalTocLink>
              <LegalTocLink href="#3.3" number="3.3" nested>
                Analytics Cookies (Performance)
              </LegalTocLink>
            </div>
          </div>
          <LegalTocLink href="#4" number="4">
            How Long Do Cookies Stay?
          </LegalTocLink>
          <div className="w-full flex flex-col items-start">
            <LegalTocLink href="#5" number="5">
              Your Choices - How to Control Cookies
            </LegalTocLink>
            <div className="w-full pl-1 flex flex-col items-start">
              <LegalTocLink href="#5.1" number="5.1" nested>
                Our Cookie Consent Banner
              </LegalTocLink>
              <LegalTocLink href="#5.2" number="5.2" nested>
                Your Browser Settings
              </LegalTocLink>
            </div>
          </div>
          <LegalTocLink href="#6" number="6">
            Do Not Track Signals
          </LegalTocLink>
          <LegalTocLink href="#7" number="7">
            Updates to This Cookie Policy
          </LegalTocLink>
          <LegalTocLink href="#8" number="8">
            Contact Us About Cookies
          </LegalTocLink>
        </>
      }
    >
      <section id="1" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          1. What Are Cookies?
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          Cookies are small text files that a website stores on your computer,
          tablet, or phone when you visit. They help the website remember
          information about you, such as your preferences or what pages you
          viewed. Cookies are not harmful - they cannot carry viruses or install
          software.
          <br />
          <br />
          Other similar technologies (like local storage or pixels) work in
          similar ways, and we include them whenever we say &quot;cookies&quot; in this
          policy.
        </p>
      </section>

      <section id="2" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          2. Why We Use Cookies
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">We use cookies to:</p>
        <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
          <LegalBullet>Make our website work properly.</LegalBullet>
          <LegalBullet>
            Remember your choices (like language or login status).
          </LegalBullet>
          <LegalBullet>
            Understand how people use our website so we can improve it.
          </LegalBullet>
          <LegalBullet isLast>
            (With your permission) Show you relevant information and offers.
          </LegalBullet>
        </div>
      </section>

      <section id="3" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          3. Types of Cookies We Use
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          Here are the cookies you will find on our website, grouped by purpose.
          You can manage most of them through your browser or our cookie consent
          banner.
        </p>
        <div className="w-full flex flex-col pl-0 sm:pl-7 mt-3 gap-5">
          <div id="3.1" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              3.1 Strictly Necessary Cookies
            </h3>
            <p className="p-2 font-light text-sm sm:text-base">
              <strong className="text-[#2A4792] font-semibold">
                Always active - you cannot turn these off.
              </strong>
              <br />
              <br />
              These cookies are essential for the website to function. Without
              them, you could not log in, navigate between pages, or use your
              digital business card.
              <br />
              <br />
              <strong className="text-[#2A4792] font-semibold">Examples:</strong>
            </p>
            <div className="w-full border border-gray-300 flex flex-col overflow-hidden rounded-lg sm:rounded-none">
              <LegalBullet>
                <span className="inline-block py-1 px-2 rounded-md bg-link-color text-white text-xs sm:text-sm break-all">
                  session_id
                </span>{" "}
                - keeps you logged in
              </LegalBullet>
              <LegalBullet>
                <span className="inline-block py-1 px-2 rounded-md bg-link-color text-white text-xs sm:text-sm break-all">
                  csrf_token
                </span>{" "}
                - protects against security threats
              </LegalBullet>
              <LegalBullet isLast>
                <span className="inline-block py-1 px-2 rounded-md bg-link-color text-white text-xs sm:text-sm break-all">
                  cookie_consent
                </span>{" "}
                - remembers your cookie preferences
              </LegalBullet>
            </div>
          </div>
          <div id="3.2" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              3.2 Preference Cookies (Functional)
            </h3>
            <p className="p-2 font-light text-sm sm:text-base">
              <strong className="text-[#2A4792] font-semibold">
                You can disable these, but some features may feel less personal.
              </strong>
              <br />
              <br />
              These cookies remember choices you make to improve your
              experience, such as your language preference, region, or dark mode
              setting.
              <br />
              <br />
              <strong className="text-[#2A4792] font-semibold">Examples:</strong>
            </p>
            <div className="w-full border border-gray-300 flex flex-col overflow-hidden rounded-lg sm:rounded-none">
              <LegalBullet>
                <span className="inline-block py-1 px-2 rounded-md bg-link-color text-white text-xs sm:text-sm break-all">
                  language
                </span>{" "}
                - remembers if you prefer English or another language
              </LegalBullet>
              <LegalBullet isLast>
                <span className="inline-block py-1 px-2 rounded-md bg-link-color text-white text-xs sm:text-sm break-all">
                  theme
                </span>{" "}
                remembers your light or dark mode choice
              </LegalBullet>
            </div>
          </div>
          <div id="3.3" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              3.3 Analytics Cookies (Performance)
            </h3>
            <p className="p-2 font-light text-sm sm:text-base">
              <strong className="text-[#2A4792] font-semibold">
                You can disable these. We will still collect basic usage data in
                an anonymous way.
              </strong>
              <br />
              <br />
              These cookies help us understand how visitors use our website -
              which pages are popular, how long people stay, and if they see
              error messages. All information is anonymous and used only to make
              our website better.
              <br />
              <br />
              <strong className="text-[#2A4792] font-semibold">Examples:</strong>
            </p>
            <div className="w-full border border-gray-300 flex flex-col overflow-hidden rounded-lg sm:rounded-none">
              <LegalBullet>
                <span className="inline-block py-1 px-2 rounded-md bg-link-color text-white text-xs sm:text-sm break-all">
                  _ga
                </span>{" "}
                (Google Analytics) - helps us count unique visitors
              </LegalBullet>
              <LegalBullet isLast>
                <span className="inline-block py-1 px-2 rounded-md bg-link-color text-white text-xs sm:text-sm break-all">
                  _gid
                </span>{" "}
                (Google Analytics) - helps us track how visitors move through
                the site
              </LegalBullet>
            </div>
          </div>
        </div>
      </section>

      <section id="4" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          4. How Long Do Cookies Stay?
        </h2>
        <div className="w-full flex flex-col mt-5 border border-gray-300 overflow-hidden rounded-lg sm:rounded-none">
          <LegalTableRow label="Type" cols={4} isHeader>
            Duration
          </LegalTableRow>
          <LegalTableRow label="Session Cookies" cols={4}>
            Deleted when you close your browser. Used for login and cart
            functions.
          </LegalTableRow>
          <LegalTableRow label="Persistent cookies" cols={4} isLast>
            Stay on your device until they expire (from a few hours to two
            years) or you delete them. Used to remember preferences or returning
            visitors.
          </LegalTableRow>
        </div>
      </section>

      <section id="5" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          5. Your Choices - How to Control Cookies
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          You have several options to manage cookies:
        </p>
        <div className="w-full flex flex-col pl-0 sm:pl-7 mt-3 gap-5">
          <div id="5.1" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              5.1 Our Cookie Consent Banner
            </h3>
            <p className="p-2 font-light text-sm sm:text-base">
              When you first visit our website, you will see a banner asking for
              your permission. You can:
            </p>
            <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
              <LegalBullet>
                <strong className="text-[#2A4792] font-semibold">
                  Accept all
                </strong>{" "}
                - allow all cookies.
              </LegalBullet>
              <LegalBullet>
                <strong className="text-[#2A4792] font-semibold">
                  Reject non-essential
                </strong>{" "}
                - allow only strictly necessary cookies.
              </LegalBullet>
              <LegalBullet isLast>
                <strong className="text-[#2A4792] font-semibold">
                  Customize
                </strong>{" "}
                - choose which types of cookies (preference, analytics,
                marketing, social media) you want to allow.
              </LegalBullet>
            </div>
          </div>
          <div id="5.2" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              5.2 Your Browser Settings
            </h3>
            <p className="p-2 font-light text-sm sm:text-base">
              Most browsers allow you to block or delete cookies entirely.
              However, if you block all cookies (including necessary ones), some
              parts of our website will not work properly.
            </p>
          </div>
        </div>
      </section>

      <section id="6" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          6. Do Not Track Signals
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          Some browsers offer a &quot;Do Not Track&quot; (DNT) setting. Our website does
          not currently respond to DNT signals because there is no universal
          standard for how to interpret them. Instead, we rely on our cookie
          consent banner to give you clear choices.
        </p>
      </section>

      <section id="7" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          7. Updates to This Cookie Policy
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          We may update this Cookie Policy occasionally. Any changes will be
          posted on this page with a revised &quot;Last updated&quot; date. If the
          changes are significant, we will notify you through our website or by
          email.
        </p>
      </section>

      <section id="8" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          8. Contact Us About Cookies
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          If you have any questions about our use of cookies, please contact us:
          <br />
          <br />
          <strong>
            Email:{" "}
            <a
              href="mailto:ontapcreatives@gmail.com"
              className="italic font-medium text-link-active-color hover:underline ease-in duration-100 transition-all break-all"
            >
              ontapcreatives@gmail.com
            </a>
          </strong>
        </p>
      </section>
    </LegalDocumentLayout>
  );
}
