// Git-owned documents: docs and blog posts authored as markdown alongside the code.

import { defineDocument, f } from "@imprint/schema";
import { PROSE_BLOCKS } from "../blocks/index";

export const docsPage = defineDocument({
  name: "docsPage",
  label: "Docs page",
  titleField: "title",
  section: "docs",
  source: "git",
  fields: {
    title: f.text({ required: true, max: 90 }),
    summary: f.textArea({ max: 200 }),
    version: f.text({ max: 20 }),
    updated: f.text(),
    draft: f.boolean(),
    body: f.blocks({ allow: PROSE_BLOCKS, required: true }),
  },
});

export const blogPost = defineDocument({
  name: "blogPost",
  label: "Blog post",
  titleField: "title",
  section: "blog",
  source: "git",
  fields: {
    title: f.text({ required: true, max: 90 }),
    summary: f.textArea({ max: 200 }),
    author: f.text({ max: 60 }),
    updated: f.text(),
    draft: f.boolean(),
    body: f.blocks({ allow: PROSE_BLOCKS, required: true }),
  },
});
