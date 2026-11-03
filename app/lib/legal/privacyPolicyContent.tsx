import {
  LegalBullet,
  LegalDocumentLayout,
  LegalTableRow,
  LegalTocLink,
} from "./LegalDocumentPrimitives";

export function PrivacyPolicyContent() {
  return (
    <LegalDocumentLayout
      title="Privacy Policy"
      toc={
        <>
          <LegalTocLink href="#1" number="1">
            Who We Are
          </LegalTocLink>
          <div className="w-full flex flex-col items-start">
            <LegalTocLink href="#2" number="2">
              What Information We Collect
            </LegalTocLink>
            <div className="w-full pl-1 flex flex-col items-start">
              <LegalTocLink href="#2.1" number="2.1" nested>
                Information You Give Us Directly
              </LegalTocLink>
              <LegalTocLink href="#2.2" number="2.2" nested>
                Information We Collect Automatically
              </LegalTocLink>
              <LegalTocLink href="#2.3" number="2.3" nested>
                Information From Third-Party Sources
              </LegalTocLink>
            </div>
          </div>
          <LegalTocLink href="#3" number="3">
            How We Use Your Information
          </LegalTocLink>
          <LegalTocLink href="#4" number="4">
            Legal Basis for Processing
          </LegalTocLink>
          <LegalTocLink href="#5" number="5">
            Sharing Your Information
          </LegalTocLink>
          <LegalTocLink href="#6" number="6">
            Your Rights and Choices
          </LegalTocLink>
          <LegalTocLink href="#7" number="7">
            How Long We Keep Your Information
          </LegalTocLink>
          <LegalTocLink href="#8" number="8">
            How We Protect Your Information
          </LegalTocLink>
          <LegalTocLink href="#9" number="9">
            Children&apos;s Privacy
          </LegalTocLink>
          <LegalTocLink href="#10" number="10">
            International Data Transfers
          </LegalTocLink>
          <LegalTocLink href="#11" number="11">
            Changes to This Privacy Policy
          </LegalTocLink>
          <LegalTocLink href="#12" number="12">
            How to Contact Us
          </LegalTocLink>
        </>
      }
    >
      <section id="1" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          1. Who We Are
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          OnTap <strong>(&quot;we&quot;, &quot;us&quot;, &quot;our&quot;)</strong> provides digital
          business card services that help you share your contact information
          quickly and professionally. This Privacy Policy explains how we
          collect, use, and protect your personal information when you use our
          website and services.
          <br />
          <br />
          If you have any questions, you can contact us at:{" "}
          <a
            href="mailto:ontapcreatives@gmail.com"
            className="italic font-medium text-link-active-color hover:underline ease-in duration-100 transition-all break-all"
          >
            ontapcreatives@gmail.com
          </a>
        </p>
      </section>

      <section id="2" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          2. What Information We Collect
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          We collect only the information that helps us provide and improve our
          service. This falls into three categories:
        </p>
        <div className="w-full flex flex-col pl-0 sm:pl-7 mt-3 gap-5">
          <div id="2.1" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              2.1 Information You Give Us Directly
            </h3>
            <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
              <LegalBullet>
                <strong className="text-[#2A4792] font-semibold">
                  When you create an account:
                </strong>{" "}
                Your name, email address, phone number, job title, company name,
                and any other details you choose to put on your digital business
                card.
              </LegalBullet>
              <LegalBullet>
                <strong className="text-[#2A4792] font-semibold">
                  When you contact us:
                </strong>{" "}
                Your name, email address, and the content of your message.
              </LegalBullet>
              <LegalBullet isLast>
                <strong className="text-[#2A4792] font-semibold">
                  When you schedule a demo:
                </strong>{" "}
                Your name, email address, phone number, and company name.
              </LegalBullet>
            </div>
          </div>
          <div id="2.2" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              2.2 Information Collected Automatically
            </h3>
            <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
              <LegalBullet>
                <strong className="text-[#2A4792] font-semibold">
                  How you use our website:
                </strong>{" "}
                Which pages you visit, how long you stay, and what you click on.
              </LegalBullet>
              <LegalBullet>
                <strong className="text-[#2A4792] font-semibold">
                  Your device and browser:
                </strong>{" "}
                Such as your device type, browser version, and approximate
                location (city or region).
              </LegalBullet>
              <LegalBullet isLast>
                <strong className="text-[#2A4792] font-semibold">
                  Interaction with your digital card:
                </strong>{" "}
                When someone views or taps your OnTap card, we may record basic
                usage data (e.g., date, time, and which card was viewed). This
                helps you understand who is engaging with your card.
              </LegalBullet>
            </div>
          </div>
          <div id="2.3" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
            <h3 className="w-full pb-1 border-b border-link-active-color text-lg sm:text-xl font-bold text-link-active-color">
              2.3 Information from Third Party Sources
            </h3>
            <p className="p-2 font-light text-sm sm:text-base">
              If you sign up through one of our partner organizations, we may
              receive basic information from them (such as your name and work
              email) to set up your account.
            </p>
          </div>
        </div>
      </section>

      <section id="3" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          3. How We Use Your Information
        </h2>
        <div className="w-full flex flex-col mt-5 border border-gray-300 overflow-hidden rounded-lg sm:rounded-none">
          <LegalTableRow label="Purpose" isHeader>
            Explanation
          </LegalTableRow>
          <LegalTableRow label="To provide our service">
            Create and manage your digital business card, allow sharing, and
            keep your information updated.
          </LegalTableRow>
          <LegalTableRow label="To improve our service">
            Analyze how people use our website and cards to fix issues and add
            helpful features.
          </LegalTableRow>
          <LegalTableRow label="To communicate with you">
            Send you important updates about your account, respond to your
            questions, and (with your permission) share news and offers.
          </LegalTableRow>
          <LegalTableRow label="To protect our service">
            Detect and prevent fraud, abuse, or security risks.
          </LegalTableRow>
          <LegalTableRow label="To comply with the law" isLast>
            Respond to legal requests and fulfill regulatory obligations.
          </LegalTableRow>
        </div>
      </section>

      <section id="4" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          4. Legal Basis for Processing
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          If you are in the European Economic Area (EEA), we process your
          information only when we have a legal reason to do so:
        </p>
        <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">Your consent:</strong>{" "}
            For optional cookies, marketing emails, and analytics.
          </LegalBullet>
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">
              Contractual necessity:
            </strong>{" "}
            To provide the digital business card service you signed up for.
          </LegalBullet>
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">
              Legitimate interests:
            </strong>{" "}
            To improve our website, prevent fraud, and grow our business in a
            way that does not override your rights.
          </LegalBullet>
          <LegalBullet isLast>
            <strong className="text-[#2A4792] font-semibold">
              Legal obligation:
            </strong>{" "}
            When we must retain or share information to comply with the law.
          </LegalBullet>
        </div>
      </section>

      <section id="5" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          5. Sharing Your Information
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          We do not sell your personal information. We only share it in these
          limited situations:
        </p>
        <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">
              With your permission:
            </strong>{" "}
            For example, when you share your digital business card with another
            person or display it at an event.
          </LegalBullet>
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">
              With service providers:
            </strong>{" "}
            Companies that help us operate (e.g., hosting, analytics, email
            delivery). They may only use your information for the tasks we hire
            them to perform.
          </LegalBullet>
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">
              For legal reasons:
            </strong>{" "}
            If required by law, court order, or to protect our rights, property,
            or safety.
          </LegalBullet>
          <LegalBullet isLast>
            <strong className="text-[#2A4792] font-semibold">
              During a business transfer:
            </strong>{" "}
            If OnTap is sold or merged, your information may be transferred to
            the new owner, who must follow this same Privacy Policy.
          </LegalBullet>
        </div>
      </section>

      <section id="6" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          6. Your Rights and Choices
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          Depending on where you live, you may have the following rights:
        </p>
        <div className="w-full flex flex-col mt-5 border border-gray-300 overflow-hidden rounded-lg sm:rounded-none">
          <LegalTableRow label="Right" cols={4} isHeader>
            What It Means
          </LegalTableRow>
          <LegalTableRow label="Access" cols={4}>
            Ask for a copy of the personal information we hold about you.
          </LegalTableRow>
          <LegalTableRow label="Correction" cols={4}>
            Ask us to fix incorrect or incomplete information.
          </LegalTableRow>
          <LegalTableRow label="Deletion" cols={4}>
            Ask us to delete your personal information (subject to certain legal
            exceptions).
          </LegalTableRow>
          <LegalTableRow label="Restriction" cols={4}>
            Ask us to temporarily stop processing your information.
          </LegalTableRow>
          <LegalTableRow label="Portability" cols={4}>
            Receive a copy of your information in a structured, machine-readable
            format.
          </LegalTableRow>
          <LegalTableRow label="Objection" cols={4}>
            Object to certain uses, such as marketing or analytics based on
            legitimate interests.
          </LegalTableRow>
          <LegalTableRow label="Withdraw consent" cols={4} isLast>
            If you previously agreed to something (like marketing emails), you
            can change your mind at any time.
          </LegalTableRow>
        </div>
        <p className="p-2 font-light text-sm sm:text-base">
          To exercise any of these rights, contact us at{" "}
          <a
            href="mailto:ontapcreatives@gmail.com"
            className="italic font-medium text-link-active-color hover:underline ease-in duration-100 transition-all break-all"
          >
            ontapcreatives@gmail.com
          </a>
          . We will respond within 30 days at no charge.
        </p>
      </section>

      <section id="7" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          7. How Long We Keep Your Information
        </h2>
        <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">
              Account information:
            </strong>{" "}
            We keep your data as long as your account is active. If you close
            your account, we will delete or anonymize your information within 90
            days, unless we need to keep it longer for legal or security
            reasons.
          </LegalBullet>
          <LegalBullet>
            <strong className="text-[#2A4792] font-semibold">Usage data:</strong>{" "}
            Analytics data is kept in aggregated form for up to 26 months.
          </LegalBullet>
          <LegalBullet isLast>
            <strong className="text-[#2A4792] font-semibold">
              Marketing data:
            </strong>{" "}
            If you unsubscribe from emails, we will keep your email address on a
            suppression list to honor your request.
          </LegalBullet>
        </div>
      </section>

      <section id="8" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          8. How We Protect Your Information
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          We use reasonable and appropriate security measures to protect your
          information from loss, misuse, or unauthorized access. These include:
        </p>
        <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
          <LegalBullet>
            Encrypted connections (HTTPS) for all data sent between your browser
            and our servers.
          </LegalBullet>
          <LegalBullet>Regular security reviews and updates.</LegalBullet>
          <LegalBullet isLast>
            Limited internal access to personal information (only employees who
            need it for their job role).
          </LegalBullet>
        </div>
        <p className="p-2 font-light text-sm sm:text-base">
          While no system is 100% secure, we continuously work to safeguard your
          data.
        </p>
      </section>

      <section id="9" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          9. Children&apos;s Privacy
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          Our service is not intended for anyone under the age of 16. We do not
          knowingly collect personal information from children. If we learn that
          we have done so, we will delete it immediately.
        </p>
      </section>

      <section id="10" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          10. International Data Transfers
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          If you are located outside the Philippines, please note that your
          information will be transferred to and processed in the Philippines or
          other countries where we or our service providers operate. We take
          steps to ensure your data receives an adequate level of protection,
          such as using standard contractual clauses approved by the European
          Commission.
        </p>
      </section>

      <section id="11" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          11. Changes to This Privacy Policy
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          We may update this Privacy Policy from time to time. If we make
          material changes, we will notify you by:
        </p>
        <div className="w-full border border-gray-300 flex flex-col mt-5 overflow-hidden rounded-lg sm:rounded-none">
          <LegalBullet>
            Posting the new policy on this page with a new &quot;Last
            updated&quot; date.
          </LegalBullet>
          <LegalBullet isLast>
            Sending you an email or displaying a prominent notice on our
            website.
          </LegalBullet>
        </div>
        <p className="p-2 font-light text-sm sm:text-base">
          We encourage you to review this policy periodically.
        </p>
      </section>

      <section id="12" className="w-full flex flex-col scroll-mt-24 lg:scroll-mt-8">
        <h2 className="w-full pb-3 border-b border-link-active-color text-xl sm:text-2xl font-bold text-link-active-color">
          12. How to Contact Us
        </h2>
        <p className="p-2 font-light text-sm sm:text-base">
          For privacy questions, complaints, or to exercise your rights:
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
          <br />
          <strong>
            Mailing address: Unit 109, 17 Vatican Building, BF Resort Village,
            Las Piñas City, Philippines
          </strong>
          <br />
          <br />
          If you are in the European Union, you also have the right to lodge a
          complaint with your local data protection authority.
        </p>
      </section>
    </LegalDocumentLayout>
  );
}
