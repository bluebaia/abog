# Import existing blog content once

Configure the new public repository first. If it is not published yet, complete the one-time GitHub Pages setting so the import can validate and deploy the result.

1. On the setup page, inspect the new repository and open **Preview a one-time import**.
2. Enter the public source repository URL. If the blog lives below the repository root, provide its directory, such as blog. You can also pin a branch or tag.
3. Run **Preview**. The task reports article and resource files, preserved slugs, skipped drafts or theme samples, unsupported fields, and conflicts. Copy the plan SHA-256 from the run summary.
4. Run **Apply** with the same source URL, ref, and directory, then paste the reviewed SHA-256. The task refuses to apply if the source or target changed after preview.

The importer reads AstroPaper Markdown from src/content/blog and Astro Cactus Markdown from content/posts and content/notes. It also recognizes this template's .blog/content/posts format. It preserves supported titles, descriptions, authors, dates, tags, featured state, slugs, Markdown bodies, and referenced local images or documents. Cactus coverImage.src values are copied to the canonical asset directory and used as social image metadata.

Drafts, files marked as samples, helper files beginning with _, theme example directories, and content from the original public theme repositories are skipped. MDX, missing dates, invalid slugs, unsupported nested fields, missing resources, duplicate addresses, and existing target files appear in the preview. Blocking items must be corrected in the source before applying. Other unsupported theme-specific fields are listed and omitted, so review them before confirming.

After successful validation the workflow deploys the imported snapshot, then stores it under .blog/content/posts/, copies referenced resources to .blog/assets/imported/, and writes .blog/imports/receipt.json. That receipt allows only one import run. The new repository becomes the content source of truth; later edits to the old repository are not synchronized.

Only public source repositories can be cloned by the workflow. The importer reads the selected source and never writes to it. Imported content and resources become part of the public target repository.
