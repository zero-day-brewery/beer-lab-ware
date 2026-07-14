export default function NotFound() {
  return (
    <section className="tap-card m-6 flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm opacity-80">
        That page does not exist. It may have moved, or the link was mistyped.
      </p>
      <a href="/recipes/" className="btn-ghost self-start">
        Back to recipes
      </a>
    </section>
  )
}
