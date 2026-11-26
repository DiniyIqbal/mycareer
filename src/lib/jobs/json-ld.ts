import type { EmploymentType, PublicJob, PublicOrganisation, SalaryPeriod } from "./types";

// https://developers.google.com/search/docs/appearance/structured-data/job-posting

const EMPLOYMENT_TYPE: Record<EmploymentType, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contractor: "CONTRACTOR",
  temporary: "TEMPORARY",
  intern: "INTERN",
  other: "OTHER",
};

const SALARY_UNIT: Record<SalaryPeriod, string> = {
  hour: "HOUR",
  day: "DAY",
  month: "MONTH",
  year: "YEAR",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Google expects HTML in `description`; jobs store plain text. */
function toHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function jobPostingJsonLd(job: PublicJob, org: PublicOrganisation, url: string) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: toHtmlParagraphs(job.description || job.title),
    datePosted: job.published_at,
    employmentType: EMPLOYMENT_TYPE[job.employment_type],
    identifier: { "@type": "PropertyValue", name: org.name, value: job.id },
    url,
    directApply: true,
    hiringOrganization: {
      "@type": "Organization",
      name: org.name,
      ...(org.website ? { sameAs: org.website } : {}),
    },
  };

  if (job.closes_at) data.validThrough = job.closes_at;

  if (job.workplace_type === "remote") {
    data.jobLocationType = "TELECOMMUTE";
    data.applicantLocationRequirements = { "@type": "Country", name: job.address_country };
  } else {
    data.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        ...(job.address_locality ? { addressLocality: job.address_locality } : {}),
        ...(job.address_region ? { addressRegion: job.address_region } : {}),
        addressCountry: job.address_country,
      },
    };
  }

  if (job.salary_period && (job.salary_min != null || job.salary_max != null)) {
    data.baseSalary = {
      "@type": "MonetaryAmount",
      currency: job.salary_currency,
      value: {
        "@type": "QuantitativeValue",
        ...(job.salary_min != null ? { minValue: Number(job.salary_min) } : {}),
        ...(job.salary_max != null ? { maxValue: Number(job.salary_max) } : {}),
        unitText: SALARY_UNIT[job.salary_period],
      },
    };
  }

  return data;
}

/** Serialise for a <script> tag without allowing `</script>` injection. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
