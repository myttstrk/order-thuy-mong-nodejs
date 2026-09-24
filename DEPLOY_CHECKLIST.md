# Deployment checklist for Thủy Mộng

## 1) Prepare environment variables on Vercel
Set these in Vercel project settings > Environment Variables:

- PORT=3000
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SEPAY_PAYMENT_URL
- SEPAY_API_KEY
- SEPAY_WEBHOOK_SECRET
- SEPAY_RETURN_URL
- RESEND_API_KEY
- RESEND_FROM

## 2) Redeploy
Run:

```bash
git add .
git commit -m "complete payment and QR flow"
git push
npx vercel --prod
```

## 3) Verify live endpoints
- https://your-domain.vercel.app/
- https://your-domain.vercel.app/admin
- https://your-domain.vercel.app/api/health
- https://your-domain.vercel.app/api/config

## 4) Payment flow test
1. Create a test order from the public page.
2. Simulate a successful SePay webhook with matching amount and orderCode.
3. Confirm order status changes to "Đã thanh toán".
4. Confirm QR check-in exists.
5. Confirm email is sent to customer.
6. Confirm admin dashboard shows the customer order.
7. Confirm QR scan marks ticket as "Đã sử dụng" and prevents duplicate check-in.

## 5) If email does not send
Check:
- RESEND_API_KEY is valid
- RESEND_FROM is accepted by Resend
- Vercel logs do not show timeout or API rejection

## 6) If admin still times out
Check:
- Vercel function timeout is not being caused by external calls
- local JSON fallback is active when external services are unavailable
- the function route is not stuck on a slow external request

