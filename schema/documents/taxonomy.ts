// Taxonomy documents: categories, tags, and other flat classification systems.

import { defineTaxonomy, f } from "@imprint/schema";

export const category = defineTaxonomy({
  name: "category",
  label: "Category",
  titleField: "name",
  fields: {
    name: f.text({ required: true, max: 60 }),
    slug: f.slug({ required: true }),
    summary: f.textArea({ max: 200 }),
  },
});

export const tag = defineTaxonomy({
  name: "tag",
  label: "Tag",
  titleField: "name",
  fields: {
    name: f.text({ required: true, max: 60 }),
    slug: f.slug({ required: true }),
  },
});
