# Writing the words

The film is twenty-four seconds. Roughly forty words appear on screen. Each one
has to earn its place.

---

## The headline

This is the only line most people read. It appears first, at the largest size.

**Good headlines are claims, not categories.**

| Weak | Strong |
|---|---|
| "A CLI tool for video generation" | "You shipped it. Now make the trailer." |
| "TypeScript utility library" | "Types that survive the network boundary." |
| "A Rust-based JSON parser" | "Parses JSON faster than you can allocate it." |

Rules that hold up:

- **Under 72 characters.** Longer and the type steps down until it stops being
  a headline.
- **No "a" or "an" opening.** "A tool that…" is a category. Lead with the verb
  or the promise.
- **Second person beats third.** "You shipped it" lands; "users can ship" does not.
- **A period is fine.** A full stop reads as confidence. An exclamation mark
  does not.
- **Never name the category if the promise implies it.** "Launch video
  generator" is what it is. "Now make the trailer" is why anyone cares.

Pass yours with `--tagline`. It overrides the README-derived line and needs no
re-analysis, so it is the cheapest thing to iterate on.

## The stats

Already written for you — they come from `story.highlights`, measured from the
repo. Your job is **subtraction**.

- Drop any number that is unimpressive *for this kind of project*. 400 commits
  is a lot for a weekend tool and nothing for a framework.
- Two strong stats beat four weak ones. The composer takes the top two.
- "1 contributor" is never a flex. The analyzer already suppresses it.
- If no stat is strong, let the feature list carry the film instead.

To change which stats appear, reorder `highlights` in `story.json` and re-run
with `--plan-only` to check, then render.

## The feature list

Pulled from README bullets. Each item wants to be a **headline, not a sentence** —
the analyzer already takes the bolded lead-in when the bullet has one.

- Under 66 characters.
- Parallel grammar across all of them. Three verb-first lines then a noun
  phrase reads as a mistake.
- Five maximum, and five is usually one too many. Four is the sweet spot.

## The share post

`SHARE.md` is generated and genuinely post-ready. But it is written in a neutral
voice, and the user has their own.

If you have seen how the user writes — their commits, their README, their issues —
**rewrite the post in their voice** and say that is what you did. If you have not,
hand over the generated copy unchanged rather than guessing at a register.

What the generated copy gets right and you should preserve:

- The name on its own line first.
- The claim second, no preamble.
- Proof third, as bare numbers separated by `·`.
- The link last, on its own line.
- No hashtags. No "excited to announce". No emoji unless the user uses emoji.

## Alt text

`SHARE.md` includes alt text. **Use it.** A launch video with no alt text
excludes people, and on most platforms it costs one paste. If you rewrite the
post, rewrite the alt text to match.
