const faqs = [
  {
    q: "Who can join?",
    a: "Anyone. Complete beginners, recreational players and competitive athletes of every age — kids, teens and adults. Whether you've never held a paddle or you're training for tournaments, there's a programme for you.",
  },
  {
    q: "Where do classes take place?",
    a: "We come to you. Sessions run at your home, apartment complex, office, school or college — wherever you have a suitable table or space — across Bengaluru.",
  },
  {
    q: "Do I need my own equipment?",
    a: "You'll need your own table tennis bat. A table should be available at your venue or home — let us know when you sign up and we'll advise. Balls are provided.",
  },
  {
    q: "Do you offer trial sessions?",
    a: "Yes — every child's first group class is free, no payment details needed. Sign up, add your player and book the trial straight from the app. There's also a discounted intro offer on your first private session.",
  },
  {
    q: "What are the class timings?",
    a: "Flexible slots run through the week — mornings, evenings and weekends. Exact times depend on your location and coach availability; check the booking page for live slots.",
  },
  {
    q: "How does membership work?",
    a: "One monthly payment, cancel anytime. Group plans hold a weekly routine — one, two or three classes a week. Private plans book 60-minute one-to-one sessions at your home, from once to four times a week. You can also pay per class without any membership; plans just work out cheaper.",
  },
  {
    q: "What if I need to cancel a session?",
    a: "Cancel more than 24 hours before the start and the session goes back into your allowance. Later than that, it counts as used.",
  },
  {
    q: "Can I cancel my membership?",
    a: "Any time, in two taps from your membership screen. Your access runs to the end of the month you've paid for.",
  },
  {
    q: "Do you coach children?",
    a: "Yes — our junior classes run after school, and every coach working with under-18s holds a verified background check.",
  },
  {
    q: "I don't have a table at home. Can I still book private sessions?",
    a: "Private sessions need a table at your address. If you don't have one, book your one-to-one time at the nearest venue instead — same coach, same focus.",
  },
  {
    q: "How do I pay for classes?",
    a: "Payment is handled securely in the app. When you choose a plan you're taken to Razorpay checkout — UPI, cards and netbanking all work — and your membership activates the moment payment clears.",
  },
];

export function Faq() {
  return (
    <div className="divide-y divide-line border-y border-line">
      {faqs.map((item) => (
        <details key={item.q} className="group py-5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <span
              aria-hidden
              className="text-ember transition-transform duration-200 group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-3 max-w-[60ch] text-fg-2">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
