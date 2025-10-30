import Image from "next/image";
import HeroSection from "@/components/HeroSection";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8">
      <div className=" mx-auto bg-white shadow-lg rounded-xl p-8">
        <h2 className="text-2xl font-semibold mb-6">Hello Chigozie</h2>

        {/* Customer */}
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">
            Bank Details
          </h3>
          <div className="border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500 mt-2">
              Account Name: Chigozie Christopher <br />
              Account Number: 0156561995 <br />
              Bank Name: Guranty Trust Bank
            </p>
          </div>
        </section>

        {/* Items */}
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">
            Pending Transactions
          </h3>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-gray-600">
                <tr>
                  <th className="text-left p-3">Item details</th>
                  <th className="text-right p-3">Qty</th>
                  <th className="text-right p-3">Price (USDC)</th>
                  <th className="text-right p-3">Price (NGN)</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-3">
                    <div className="font-medium">Website Design</div>
                    <div className="text-gray-500 text-xs">
                      Designed 10 page website.
                    </div>
                  </td>
                  <td className="text-right p-3">10</td>
                  <td className="text-right p-3">1,000.00 USDT</td>
                  <td className="text-right p-3">6%</td>

                  <td className="text-right p-3 text-gray-400 cursor-pointer">
                    Accept Lock Amount
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">
                    <div className="font-medium">Logo Design</div>
                    <div className="text-gray-500 text-xs">
                      Designed logo for the app.
                    </div>
                  </td>
                  <td className="text-right p-3">1</td>
                  <td className="text-right p-3">3,000.00 USDT</td>
                  <td className="text-right p-3">-</td>

                  <td className="text-right p-3 text-gray-400 cursor-pointer">
                    ✕
                  </td>
                </tr>
                <tr>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">PDF Creation</span>
                      <span className="bg-gray-100 border border-gray-300 text-xs px-2 py-0.5 rounded-full">
                        20.00 USDT off
                      </span>
                    </div>
                    <div className="text-gray-500 text-xs">
                      Designed 2 PDFs.
                    </div>
                  </td>
                  <td className="text-right p-3">1</td>
                  <td className="text-right p-3">100.00 USDT</td>
                  <td className="text-right p-3">6%</td>
                  <td className="text-right p-3 text-gray-400 cursor-pointer">
                    ✕
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <button className="mt-3 text-fuchsia-600 hover:text-fuchsia-700 font-medium text-sm">
            + Add another item
          </button>
        </section>

        {/* Summary */}
        <div className="flex justify-end">
          <div className="w-full sm:w-1/2 border-t border-gray-200 pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>13,080.00 USDT</span>
            </div>
            <div className="flex justify-between">
              <span>GST (6% on 10,000.00)</span>
              <span>600.00 USDT</span>
            </div>
            <div className="flex justify-between">
              <span>GST (6% on 80.00)</span>
              <span>4.80 USDT</span>
            </div>
            <div className="flex justify-between text-base font-semibold mt-3">
              <span>Amount due</span>
              <span>13,684.80 USDT</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
