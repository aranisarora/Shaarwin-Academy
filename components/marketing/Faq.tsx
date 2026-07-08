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
    a: "No. Tables, nets and balls are provided at every venue. Bring trainers and a paddle if you have one — we have spares if you don't.",
  },
  {
    q: "Do you offer trial sessions?",
    a: "Yes. We offer a trial class so you can experience the coaching before committing. Reach out on WhatsApp or by email to arrange one.",
  },
  {
    q: "What are the class timings?",
    a: "Flexible slots run through the week — mornings, evenings and weekends. Exact times depend on your location and coach availability; check the booking page for live slots.",
  },
  {
    q: "How does membership work?",
    a: "One quarterly payment. Group covers up to two sessions a week, Group+ is unlimited, and Private adds 240 minutes of one-to-one coaching at your home each quarter.",
  },
  {
    q: "What if I need to cancel a session?",
    a: "Cancel more than 24 hours before the start and the session goes back into your allowance. Later than that, it counts as used.",
  },
  {
    q: "Can I cancel my membership?",
    a: "Any time, in two taps from your membership screen. Your access runs to the end of the quarter you've paid for.",
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
