import { redirect } from "next/navigation";

/** The stable address of a page: /page/<id>. Pages are shown inside Context. */
export default async function PageLink({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/context?node=${encodeURIComponent((await params).id)}`);
}
