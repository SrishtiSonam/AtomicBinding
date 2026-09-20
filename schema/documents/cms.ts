// CMS-owned documents: managed and authored through the studio.

import { defineDocument, f } from "@imprint/schema";
import { PAGE_BLOCKS, PROSE_BLOCKS } from "../blocks/index";

export const changelogEntry = defineDocument({
  name: "changelogEntry",
  label: "Changelog entry",
  titleField: "title",
  route: "/changelog/{slug}",
  section: "changelog",
  fields: {
    title: f.text({ required: true, max: 120 }),
    slug: f.slug({ required: true }),
    publishedAt: f.datetime({ required: true }),
    kind: f.select({
      options: ["added", "changed", "deprecated", "removed", "fixed", "security"],
      default: "changed",
      required: true,
    }),
    summary: f.textArea({ max: 300 }),
    docsEntry: f.reference({ to: "docsPage" }),
    body: f.blocks({ allow: PROSE_BLOCKS, required: true }),
  },
});

export const release = defineDocument({
  name: "release",
  label: "Release",
  titleField: "title",
  route: "/releases/{version}",
  section: "changelog",
  fields: {
    title: f.text({ required: true, max: 60 }),
    version: f.text({ required: true, max: 30 }),
    releasedAt: f.datetime({ required: true }),
    summary: f.textArea({ max: 300 }),
    notes: f.richText(),
    changes: f.referenceList({ to: "changelogEntry" }),
    affects: f.referenceList({ to: "docsPage" }),
  },
});

export const integration = defineDocument({
  name: "integration",
  label: "Integration",
  titleField: "name",
  route: "/integrations/{slug}",
  section: "integrations",
  schemaVersion: 2,
  fields: {
    name: f.text({ required: true, max: 60 }),
    slug: f.slug({ required: true }),
    summary: f.textArea({ required: true, max: 200 }),
    logo: f.image({ required: true }),
    category: f.reference({ to: "category", required: true }),
    tags: f.referenceList({ to: "tag" }),
    docsEntry: f.reference({ to: "docsPage" }),
    minRelease: f.reference({ to: "release" }),
    body: f.blocks({ allow: PROSE_BLOCKS }),
  },
});

export const marketingPage = defineDocument({
  name: "marketingPage",
  label: "Marketing page",
  titleField: "title",
  route: "/{slug}",
  section: "marketing",
  fields: {
    title: f.text({ required: true, max: 90 }),
    slug: f.slug({ required: true }),
    summary: f.textArea({ max: 220 }),
    body: f.blocks({ allow: PAGE_BLOCKS, required: true, minCount: 1 }),
  },
});

export const navigation = defineDocument({
  name: "navigation",
  label: "Navigation",
  titleField: "label",
  section: "marketing",
  singleton: true,
  fields: {
    label: f.text({ required: true, max: 60 }),
    items: f.objectList({
      required: true,
      fields: {
        label: f.text({ required: true, max: 40 }),
        target: f.link({ required: true }),
      },
    }),
  },
});

export const siteSettings = defineDocument({
  name: "siteSettings",
  label: "Site settings",
  titleField: "siteName",
  section: "marketing",
  singleton: true,
  fields: {
    siteName: f.text({ required: true, max: 60 }),
    tagline: f.text({ max: 120 }),
    footerNote: f.textArea({ max: 200 }),
    homePage: f.reference({ to: "marketingPage" }),
  },
});
