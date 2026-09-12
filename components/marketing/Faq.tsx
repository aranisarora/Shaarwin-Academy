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
    a: "Yes — every child's first group class is free, no payment details needed. Message us on WhatsApp with your child's name and age and we'll put them in the nearest class. There's also a discounted intro offer on your first private session.",
  },
  {
    q: "What are the class timings?",
    a: "Flexible slots run through the week — mornings, evenings and weekends. Message us on WhatsApp with your area and we'll send this week's group classes at the venue nearest you; exact private timings depend on your location and coach availability.",
  },
  {
    q: "How does membership work?",
    a: "One monthly payment, cancel anytime. Group plans hold a weekly routine — one, two or three classes a week. Private plans book 60-minute one-to-one sessions at your home, from once to four times a week. You can also pay per class without any membership; plans just work out cheaper. We'll set it all up with you over WhatsApp.",
  },
  {
    q: "What if I need to cancel a session?",
    a: "Cancel more than 24 hours before the start and the session goes back into your allowance. Later than that, it counts as used.",
  },
  {
    q: "Can I cancel my membership?",
    a: "Any time — just say so in the WhatsApp thread. Your access runs to the end of the month you've paid for.",
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
    a: "We send a payment link in the WhatsApp thread — UPI, cards and netbanking all work. Your place is held as soon as payment clears.",
  },
  {
    q: "How do I book a class?",
    a: "On WhatsApp. Tell us your area and we'll send you this week's classes; pick one and your place is held in the same thread — which also handles rescheduling, cancelling and questions. There's no app to install and no account to create.",
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
