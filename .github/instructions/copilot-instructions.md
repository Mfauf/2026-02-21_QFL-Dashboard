- **Always** use a Mobile-First approuch when writing CSS. This means that you should write styles for mobile devices first, and then use media queries to add styles for larger screens.
- **Always** ensure responsive design by using relative units (like %, em, rem) instead of fixed units (like px) for layout and typography.
- **Always** ensure responsviness using flexbox or CSS grid for layout to create flexible and adaptive designs.
- **Always** use tailwind CSS for styling to maintain consistency and efficiency in your design.
- **Always** use w-full or max-w-full and h-full for containers to prevent horizontal scrolling on smaller screens.
- **Never** use fised widths like w-[400px] on mobile views; use percentagees or flex-1
- **Always** write useful comments in your code to explain the purpose of complex sections or to provide context for future developers.
- **Always** organize your code in multiple files and folders based on functionality (e.g., components, styles, utils) to improve maintainability and readability.
- **If** there is a better approuch to solve a problem, suggest it and explain why it is better than the solution I offered before implementing it, and wait for my approval before implementing it.
- **Branches**: always develop on `dev` branch in github.
- **Always commit after each logical feature or fix** — do not batch unrelated changes into one commit.
- **Keep responses concise** — brief confirmation after completing work, with a short explanation of what was done and why. Avoid long introductions.

### CSS / Tailwind
- **Mobile-first**: write base styles for mobile, use `md:` / `lg:` prefixes for larger screens.
- Use Tailwind utility classes for all styling. Custom CSS in `css/styles.css` only for things Tailwind cannot do (animations, CSS variables, scrollbar, etc.).
- Use `w-full` / `max-w-full` for containers. Never use fixed widths like `w-[400px]` on elements that appear on mobile.
- Use CSS custom properties (`var(--clr-primary)`, `var(--clr-bg)`, etc.) for all theme colors — never hardcode hex values in Tailwind classes or inline styles.
- All interactive elements must have `:hover`, `:focus`, and `transition` styles.

## Debugging Approach

When a bug is reported:
1. **Read the relevant files first** — never guess at the cause.
2. Identify the root cause precisely before touching any code.
3. Fix the root cause, not the symptom.
4. Explain the root cause clearly in the commit message body.
5. Check for related issues that the same bug might have caused elsewhere.