import Stripe from 'stripe'

// Typed like the removed field under old stripe types, like the new location under new ones.
type CheckoutShippingDetails<T> = T extends { shipping_details: infer S }
  ? S
  : T extends { collected_information: infer C }
    ? NonNullable<C> extends { shipping_details: infer S }
      ? S | null
      : null
    : null;

// The old top-level field when present (old-version payloads), otherwise
// collected_information.shipping_details, which holds only address and name.
function getCheckoutShippingDetails<T extends object>(session: T): CheckoutShippingDetails<T> {
  const legacy: unknown = Reflect.get(session, 'shipping_details');
  const collected: unknown = Reflect.get(session, 'collected_information');
  const moved: unknown =
    collected && typeof collected === 'object' ? Reflect.get(collected, 'shipping_details') : undefined;
  return (legacy !== undefined ? legacy : (moved ?? null)) as CheckoutShippingDetails<T>;
}

// Check if Stripe key is configured and valid format
const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
const isValidKey = stripeKey && (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('sk_live_'))

const stripe = isValidKey ? new Stripe(stripeKey, {
  apiVersion: '2026-09-30.endive',
}) : null

// Resource route - GET handler
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('session_id')

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing session_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (!stripe) {
    return new Response(JSON.stringify({ error: 'Stripe is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer_details'],
    })

    return new Response(JSON.stringify({
      status: session.status,
      customer_email: session.customer_details?.email || session.customer_email,
      amount_total: session.amount_total,
      shipping_details: (getCheckoutShippingDetails(session)),
      metadata: session.metadata,
      payment_intent: session.payment_intent,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error fetching session:', error)

    if (error instanceof Stripe.errors.StripeError) {
      return new Response(JSON.stringify({
        error: error.message,
        type: error.type,
      }), {
        status: error.statusCode || 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      error: 'Failed to fetch session',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
