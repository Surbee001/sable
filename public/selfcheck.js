/*
 * Paste this into the DevTools console on the Sable page.
 *
 * It drives the whole tool surface exactly the way an agent does, through
 * document.modelContext, and prints what came back. Use it to confirm the page
 * works before you go looking for a fault in an agent.
 */
;(async () => {
  const ctx = document.modelContext
  if (!ctx) return console.error('No document.modelContext. Nothing to test.')

  const call = async (name, args = {}) => {
    const tool = (await ctx.getTools()).find((t) => t.name === name)
    if (!tool) return { missing: name }
    if (typeof ctx.executeTool !== 'function') {
      return { note: 'This context has no executeTool(), so only an agent can call these.' }
    }
    try {
      return JSON.parse(await ctx.executeTool(tool, JSON.stringify(args)))
    } catch (e) {
      return { threw: String(e) }
    }
  }
  const text = (r) => r?.content?.find((c) => c.type === 'text')?.text ?? JSON.stringify(r)
  const hasImage = (r) => Boolean(r?.content?.find((c) => c.type === 'image'))

  const names = (await ctx.getTools()).map((t) => t.name)
  console.log('%cSable self check', 'font-weight:700;font-size:14px')
  console.log(`${names.length} tools registered:`, names.join(', '))

  console.group('assess_painting')
  const a = await call('assess_painting')
  console.log(text(a))
  console.log('returns an image:', hasImage(a))
  console.groupEnd()

  console.group('suggest_palette')
  console.log(text(await call('suggest_palette', { mood: 'grey day' })))
  console.groupEnd()

  console.group('paint')
  const painted = await call('paint', {
    summary: 'self check',
    strokes: [
      {
        path: 'M 120 120 C 220 60 340 180 460 110',
        brush: 'round', pigment: 'indigo', water: 0.45, opacity: 0.6,
        note: 'a line drawn by the self check',
      },
    ],
  })
  console.log(text(painted))
  console.log('returns an image:', hasImage(painted))
  const id = painted?.structuredContent?.painted?.[0]?.id
  console.groupEnd()

  if (id) {
    console.group('revise_stroke')
    console.log(text(await call('revise_stroke', { id, water: 0.9, pigment: 'burnt-sienna' })))
    console.groupEnd()
    console.group('lift_strokes')
    console.log(text(await call('lift_strokes', { ids: [id] })))
    console.groupEnd()
  }

  console.group('dynamic registration')
  const before = (await ctx.getTools()).length
  console.log(`${before} tools now. Select a mark in the app, then run:`)
  console.log('  (await document.modelContext.getTools()).map(t => t.name)')
  console.log('and revise_selection and describe_selection should have appeared.')
  console.groupEnd()

  console.log('%cDone. If every group above printed a result, the page is working.',
    'color:#3fae72;font-weight:600')
})()
