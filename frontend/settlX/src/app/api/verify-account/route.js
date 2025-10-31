// app/api/verify-account/route.js
import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountNumber = searchParams.get("account_number");
  const bankCode = searchParams.get("bank_code");

  // Debug: Check if environment variable is loaded
  console.log(
    "Paystack Key exists:",
    !!process.env.NEXT_PUBLIC_PAYSTACK_SECRET_KEY
  );
  console.log(
    "Paystack Key length:",
    process.env.NEXT_PUBLIC_PAYSTACK_SECRET_KEY?.length
  );

  if (!process.env.NEXT_PUBLIC_PAYSTACK_SECRET_KEY) {
    return NextResponse.json(
      { error: "Server configuration error: Paystack key missing" },
      { status: 500 }
    );
  }

  if (!accountNumber || !bankCode) {
    return NextResponse.json(
      { error: "Account number and bank code are required" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to verify account" },
      { status: 500 }
    );
  }
}
